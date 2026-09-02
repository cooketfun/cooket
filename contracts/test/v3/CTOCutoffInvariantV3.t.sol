// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {CooketCurveV3} from "../../src/v3/CooketCurveV3.sol";
import {CTORegistryV3} from "../../src/v3/CTORegistryV3.sol";
import {CTOTreasuryV3} from "../../src/v3/CTOTreasuryV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";
import {MockCTOControllerV3} from "./mocks/MockCTOControllerV3.sol";

contract CTOCutoffHandlerV3 {
    FeeManagerV3 public immutable feeManager;
    CooketCurveV3 public immutable curve;
    address public immutable token;
    address public immutable previousRecipient;

    constructor(FeeManagerV3 feeManager_, CooketCurveV3 curve_, address token_, address previousRecipient_) payable {
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

contract CTOCutoffInvariantV3Test is CooketV3TestBase {
    CTORegistryV3 private registry;
    CTOTreasuryV3 private ctoTreasury;
    CTOCutoffHandlerV3 private handler;
    uint256 private supplyBefore;

    function setUp() public override {
        super.setUp();
        registry = CTORegistryV3(feeManager.ctoRegistry());
        MockCTOControllerV3 controller = new MockCTOControllerV3();
        _buy(buyer, curve, 0.1 ether);
        vm.prank(creator);
        (bytes32 id, address treasuryAddress) = registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        ctoTreasury = CTOTreasuryV3(payable(treasuryAddress));
        controller.accept(ctoTreasury, id);
        vm.warp(block.timestamp + 72 hours);
        registry.executeCTO(id);
        supplyBefore = token.totalSupply();
        handler = new CTOCutoffHandlerV3{value: 100 ether}(feeManager, curve, address(token), creator);
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
