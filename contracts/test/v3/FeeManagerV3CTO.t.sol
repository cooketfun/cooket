// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CTORegistryV3} from "../../src/v3/CTORegistryV3.sol";
import {CTOTreasuryV3} from "../../src/v3/CTOTreasuryV3.sol";
import {IFeeManagerV3} from "../../src/v3/interfaces/IFeeManagerV3.sol";
import {CooketTokenV3} from "../../src/v3/CooketTokenV3.sol";
import {CooketCurveV3} from "../../src/v3/CooketCurveV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";
import {MockCTOControllerV3} from "./mocks/MockCTOControllerV3.sol";

contract RejectingCheckpointRecipientV3 {
    receive() external payable {
        revert("REJECT");
    }
}

contract FeeManagerV3CTOTest is CooketV3TestBase {
    CTORegistryV3 internal registry;
    MockCTOControllerV3 internal controller;

    function setUp() public override {
        super.setUp();
        registry = CTORegistryV3(feeManager.ctoRegistry());
        controller = new MockCTOControllerV3();
    }

    function testConstructorRegistryIsCanonicalImmutableAndHasNoBindingSelector() public view {
        assertTrue(address(registry) != address(0));
        assertEq(registry.feeManager(), address(feeManager));
        assertEq(registry.ctoPolicyHash(), keccak256("cooket-voluntary-cto-v1"));
        assertEq(feeManager.ctoPolicyHash(), keccak256("cooket-voluntary-cto-v1"));
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
        vm.expectRevert(IFeeManagerV3.UnauthorizedCTORegistry.selector);
        feeManager.activateCTO(address(token), treasury);
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
        vm.expectRevert(IFeeManagerV3.NothingToClaim.selector);
        feeManager.claimCheckpointedCreatorFees(address(token), creator);

        _buy(buyer, curve, 0.1 ether);
        uint256 newAmount = feeManager.creatorFeesAccrued(address(token));
        uint256 treasuryBefore = ctoTreasury.balance;
        vm.prank(buyer);
        feeManager.claimCreatorFees(address(token));
        assertEq(ctoTreasury.balance - treasuryBefore, newAmount);
    }

    function testRejectingCheckpointRecipientRollsBack() public {
        RejectingCheckpointRecipientV3 rejecting = new RejectingCheckpointRecipientV3();
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), address(rejecting));
        vm.prank(address(rejecting));
        feeManager.acceptCreatorPayout(address(token));
        _buy(buyer, curve, 0.1 ether);
        uint256 amount = feeManager.creatorFeesAccrued(address(token));
        _activate();

        vm.expectRevert(IFeeManagerV3.NativeTransferFailed.selector);
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
        vm.expectRevert(IFeeManagerV3.CTOActive.selector);
        feeManager.proposeCreatorPayout(address(token), buyer);
        vm.expectRevert(IFeeManagerV3.CTOActive.selector);
        feeManager.acceptCreatorPayout(address(token));
        vm.expectRevert(IFeeManagerV3.CTOActive.selector);
        feeManager.cancelCreatorPayout(address(token));
        vm.stopPrank();
        assertEq(feeManager.protocolFeesAccrued(), protocol);
        assertEq(feeManager.communityFeesAccrued(), community);
        assertEq(feeManager.traderRewardsFeesAccrued(), rewards);
    }

    function testNonCTOTokenRetainsExistingPayoutFlow() public {
        (CooketTokenV3 tokenTwo, CooketCurveV3 curveTwo) = _launch(creator, "Non CTO", "NCTO");
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
        controller.accept(CTOTreasuryV3(payable(deployedTreasury)), id);
        vm.warp(block.timestamp + 72 hours);
        registry.executeCTO(id);
        return deployedTreasury;
    }
}
