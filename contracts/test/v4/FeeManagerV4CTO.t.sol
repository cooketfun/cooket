// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CTORegistryV4} from "../../src/v4/CTORegistryV4.sol";
import {CTOTreasuryV4} from "../../src/v4/CTOTreasuryV4.sol";
import {IFeeManagerV4} from "../../src/v4/interfaces/IFeeManagerV4.sol";
import {CooketTokenV4} from "../../src/v4/CooketTokenV4.sol";
import {CooketCurveV4} from "../../src/v4/CooketCurveV4.sol";
import {CooketV4TestBase} from "./helpers/CooketV4TestBase.sol";
import {MockCTOControllerV4} from "./mocks/MockCTOControllerV4.sol";

contract RejectingCheckpointRecipientV4 {
    receive() external payable {
        revert("REJECT");
    }
}

contract FeeManagerV4CTOTest is CooketV4TestBase {
    CTORegistryV4 internal registry;
    MockCTOControllerV4 internal controller;

    function setUp() public override {
        super.setUp();
        registry = CTORegistryV4(feeManager.ctoRegistry());
        controller = new MockCTOControllerV4();
    }

    function testConstructorRegistryIsCanonicalImmutableAndHasNoBindingSelector() public view {
        assertTrue(address(registry) != address(0));
        assertEq(registry.feeManager(), address(feeManager));
        assertEq(registry.protocolVersionHash(), keccak256("endpoint-cp-v4"));
        assertEq(registry.ctoPolicyHash(), keccak256("cooket-voluntary-cto-v2"));
        assertEq(feeManager.ctoPolicyHash(), keccak256("cooket-voluntary-cto-v2"));
    }

    function testNoExternalRegistryBindingSelectorExists() public {
        (bool bindSuccess,) = address(feeManager).call(abi.encodeWithSignature("bindRegistry(address)", buyer));
        (bool setSuccess,) = address(feeManager).call(abi.encodeWithSignature("setRegistry(address)", buyer));
        (bool governanceSuccess,) =
            address(feeManager).call(abi.encodeWithSignature("bindCTOGovernanceOnce(address)", buyer));
        assertFalse(bindSuccess);
        assertFalse(setSuccess);
        assertFalse(governanceSuccess);
    }

    function testRegistryOnlyActivation() public {
        vm.prank(creator);
        (, address treasury) = registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV4.UnauthorizedCTORegistry.selector);
        feeManager.activateCTO(address(token), treasury);
        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV4.UnauthorizedCTORegistry.selector);
        feeManager.switchCreatorPayoutForCTO(address(token), treasury);
        vm.prank(buyer);
        vm.expectRevert(IFeeManagerV4.UnauthorizedCTORegistry.selector);
        feeManager.checkpointCreatorFeesForCTO(address(token), treasury);

        vm.prank(address(registry));
        vm.expectRevert(IFeeManagerV4.CTOCheckpointMissing.selector);
        feeManager.activateCTO(address(token), treasury);

        vm.prank(address(registry));
        feeManager.checkpointCreatorFeesForCTO(address(token), treasury);
        vm.prank(address(registry));
        vm.expectRevert(IFeeManagerV4.CTORouteNotSwitched.selector);
        feeManager.activateCTO(address(token), treasury);

        vm.prank(address(registry));
        feeManager.switchCreatorPayoutForCTO(address(token), treasury);
        vm.prank(address(registry));
        feeManager.activateCTO(address(token), treasury);
        assertTrue(feeManager.ctoActive(address(token)));
    }

    function testExactCheckpointClaimsAndFutureRoutingDoNotOverlap() public {
        _buy(buyer, curve, 0.1 ether);
        uint256 oldAmount = feeManager.creatorFeesAccrued(address(token));
        uint256 aggregateBefore = feeManager.totalCreatorFeesAccrued();
        uint256 liabilitiesBefore = feeManager.totalLiabilities();
        address ctoTreasury = _activate();

        assertEq(feeManager.checkpointedCreatorFees(address(token), creator), oldAmount);
        assertEq(feeManager.totalCreatorFeesAccrued(), aggregateBefore);
        assertEq(feeManager.totalLiabilities(), liabilitiesBefore);
        uint256 creatorBefore = creator.balance;
        vm.prank(buyer);
        feeManager.claimCheckpointedCreatorFees(address(token), creator);
        assertEq(creator.balance - creatorBefore, oldAmount);
        vm.expectRevert(IFeeManagerV4.NothingToClaim.selector);
        feeManager.claimCheckpointedCreatorFees(address(token), creator);

        _buy(buyer, curve, 0.1 ether);
        uint256 newAmount = feeManager.creatorFeesAccrued(address(token));
        uint256 treasuryBefore = ctoTreasury.balance;
        vm.prank(buyer);
        feeManager.claimCreatorFees(address(token));
        assertEq(ctoTreasury.balance - treasuryBefore, newAmount);
    }

    function testRejectingCheckpointRecipientRollsBack() public {
        RejectingCheckpointRecipientV4 rejecting = new RejectingCheckpointRecipientV4();
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), address(rejecting));
        vm.prank(address(rejecting));
        feeManager.acceptCreatorPayout(address(token));
        _buy(buyer, curve, 0.1 ether);
        uint256 amount = feeManager.creatorFeesAccrued(address(token));
        _activate();

        vm.expectRevert(IFeeManagerV4.NativeTransferFailed.selector);
        feeManager.claimCheckpointedCreatorFees(address(token), address(rejecting));
        assertEq(feeManager.checkpointedCreatorFees(address(token), address(rejecting)), amount);
        assertEq(feeManager.totalCreatorFeesAccrued(), amount);
    }

    function testPayoutRotationPermanentlyDisabledAndOtherBucketsIsolated() public {
        _buy(buyer, curve, 0.1 ether);
        uint256 protocol = feeManager.protocolFeesAccrued();
        uint256 community = feeManager.communityFeesAccrued();
        uint256 rewards = feeManager.traderRewardsFeesAccrued();
        _activate();

        vm.startPrank(creator);
        vm.expectRevert(IFeeManagerV4.CTOActive.selector);
        feeManager.proposeCreatorPayout(address(token), buyer);
        vm.expectRevert(IFeeManagerV4.CTOActive.selector);
        feeManager.acceptCreatorPayout(address(token));
        vm.expectRevert(IFeeManagerV4.CTOActive.selector);
        feeManager.cancelCreatorPayout(address(token));
        vm.stopPrank();
        assertEq(feeManager.protocolFeesAccrued(), protocol);
        assertEq(feeManager.communityFeesAccrued(), community);
        assertEq(feeManager.traderRewardsFeesAccrued(), rewards);
    }

    function testNonCTOTokenRetainsExistingPayoutFlow() public {
        (CooketTokenV4 tokenTwo, CooketCurveV4 curveTwo) = _launch(creator, "Non CTO", "NCTO");
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(tokenTwo), buyer);
        vm.prank(buyer);
        feeManager.acceptCreatorPayout(address(tokenTwo));
        _buy(buyer, curveTwo, 0.1 ether);
        uint256 beforeBalance = buyer.balance;
        feeManager.claimCreatorFees(address(tokenTwo));
        assertGt(buyer.balance, beforeBalance);
    }

    function _activate() private returns (address treasury) {
        vm.prank(creator);
        (bytes32 id, address deployedTreasury) =
            registry.proposeCTO(address(token), address(controller), bytes32(0), "");
        controller.accept(CTOTreasuryV4(payable(deployedTreasury)), id);
        return deployedTreasury;
    }
}
