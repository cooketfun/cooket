// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FeeManagerV4} from "../../src/v4/FeeManagerV4.sol";
import {CooketCurveV4} from "../../src/v4/CooketCurveV4.sol";
import {CTORegistryV4} from "../../src/v4/CTORegistryV4.sol";
import {CTOTreasuryV4} from "../../src/v4/CTOTreasuryV4.sol";
import {CooketV4TestBase} from "./helpers/CooketV4TestBase.sol";
import {MockCTOControllerV4} from "./mocks/MockCTOControllerV4.sol";

contract CTOCutoffHandlerV4 {
    FeeManagerV4 public immutable feeManager;
    CooketCurveV4 public immutable curve;
    address public immutable token;
    address public immutable previousRecipient;

    constructor(FeeManagerV4 feeManager_, CooketCurveV4 curve_, address token_, address previousRecipient_) payable {
        feeManager = feeManager_;
        curve = curve_;
        token = token_;
        previousRecipient = previousRecipient_;
    }

    function buy(uint96 seed) external {
        if (curve.graduated()) return;
        uint256 gross = 1 + (uint256(seed) % 0.01 ether);
        if (address(this).balance < gross) return;
        try curve.buy{value: gross}(0, block.timestamp) {} catch {}
    }

    function claimCurrent() external {
        try feeManager.claimCreatorFees(token) {} catch {}
    }

    function claimCheckpointed() external {
        try feeManager.claimCheckpointedCreatorFees(token, previousRecipient) {} catch {}
    }

    receive() external payable {}
}

contract CTOCutoffInvariantV4Test is CooketV4TestBase {
    CTORegistryV4 private registry;
    CTOTreasuryV4 private ctoTreasury;
    CTOCutoffHandlerV4 private handler;
    uint256 private supplyBefore;

    function setUp() public override {
        super.setUp();
        registry = CTORegistryV4(feeManager.ctoRegistry());
        MockCTOControllerV4 controller = new MockCTOControllerV4();
        _buy(buyer, curve, 0.1 ether);
        vm.prank(creator);
        (bytes32 id, address treasuryAddress) = registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        ctoTreasury = CTOTreasuryV4(payable(treasuryAddress));
        controller.accept(ctoTreasury, id);
        supplyBefore = token.totalSupply();
        handler = new CTOCutoffHandlerV4{value: 100 ether}(feeManager, curve, address(token), creator);
        targetContract(address(handler));
    }

    function invariantFeeManagerBalanceBacksEveryLiability() public view {
        assertEq(address(feeManager).balance, feeManager.totalLiabilities());
        assertEq(
            feeManager.totalLiabilities(),
            feeManager.protocolFeesAccrued() + feeManager.totalCreatorFeesAccrued() + feeManager.communityFeesAccrued()
                + feeManager.traderRewardsFeesAccrued()
        );
    }

    function invariantCTOIsPermanentAndCreatorIdentityDoesNotChange() public view {
        assertTrue(feeManager.ctoActive(address(token)));
        assertEq(feeManager.ctoTreasuryOf(address(token)), address(ctoTreasury));
        assertEq(feeManager.creatorPayoutOf(address(token)), address(ctoTreasury));
        assertEq(feeManager.creatorOf(address(token)), creator);
        assertEq(token.creator(), creator);
        assertEq(token.totalSupply(), supplyBefore);
    }

    function invariantCheckpointAndCurrentBucketsCannotOverlapRecipients() public view {
        assertEq(feeManager.checkpointedCreatorFees(address(token), address(ctoTreasury)), 0);
        assertEq(feeManager.creatorPayoutOf(address(token)), address(ctoTreasury));
    }

    function invariantPhaseABAccountingRemainsBounded() public view {
        assertLe(curve.soldSupply(), CURVE_ALLOCATION);
        assertLe(curve.activeNativeUsdcReserve(), GRADUATION_NATIVE_USDC_RESERVE);
        assertEq(address(curve).balance, curve.activeNativeUsdcReserve());
    }
}
