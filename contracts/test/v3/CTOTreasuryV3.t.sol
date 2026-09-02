// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CTORegistryV3} from "../../src/v3/CTORegistryV3.sol";
import {CTOTreasuryV3} from "../../src/v3/CTOTreasuryV3.sol";
import {ICTOTreasuryV3} from "../../src/v3/interfaces/ICTOTreasuryV3.sol";
import {ArcNativeUsdcV3} from "../../src/v3/libraries/ArcNativeUsdcV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";
import {MockCTOControllerV3} from "./mocks/MockCTOControllerV3.sol";

contract MockSupportedAssetV3 is ERC20 {
    constructor() ERC20("Supported", "SUP") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract RejectingNativeRecipientV3 {
    receive() external payable {
        revert("REJECT");
    }
}

contract CTOTreasuryV3Test is CooketV3TestBase {
    CTORegistryV3 internal registry;
    MockCTOControllerV3 internal controller;
    CTOTreasuryV3 internal ctoTreasury;
    bytes32 internal proposalId;

    function setUp() public override {
        super.setUp();
        registry = CTORegistryV3(feeManager.ctoRegistry());
        controller = new MockCTOControllerV3();
        vm.prank(creator);
        address treasuryAddress;
        (proposalId, treasuryAddress) =
            registry.proposeCTO(address(token), address(controller), bytes32(0), "ipfs://cto");
        ctoTreasury = CTOTreasuryV3(payable(treasuryAddress));
    }

    function testImmutableRelationshipsBuiltinsAndControllerOnlyAcceptance() public {
        assertEq(ctoTreasury.registry(), address(registry));
        assertEq(ctoTreasury.launchToken(), address(token));
        assertEq(ctoTreasury.controller(), address(controller));
        assertEq(ctoTreasury.canonicalUsdc(), ArcNativeUsdcV3.CANONICAL_USDC);
        assertTrue(ctoTreasury.isSupportedAsset(address(0)));
        assertTrue(ctoTreasury.isSupportedAsset(address(token)));
        assertTrue(ctoTreasury.isSupportedAsset(ArcNativeUsdcV3.CANONICAL_USDC));
        vm.expectRevert(ICTOTreasuryV3.UnauthorizedController.selector);
        ctoTreasury.acceptCTO(proposalId);
        controller.accept(ctoTreasury, proposalId);
    }

    function testDisbursementBlockedBeforeActivationAndRestrictedToController() public {
        vm.deal(address(ctoTreasury), 1 ether);
        vm.expectRevert(ICTOTreasuryV3.UnauthorizedController.selector);
        ctoTreasury.transferAsset(address(0), buyer, 1);
        vm.expectRevert(ICTOTreasuryV3.CTOInactive.selector);
        controller.transferAsset(ctoTreasury, address(0), buyer, 1);
    }

    function testAdditionalAssetRegistrationAndNativeERC20Disbursement() public {
        _activate();
        MockSupportedAssetV3 asset = new MockSupportedAssetV3();
        vm.expectRevert(ICTOTreasuryV3.UnauthorizedController.selector);
        ctoTreasury.registerSupportedAsset(address(asset));
        controller.registerAsset(ctoTreasury, address(asset));
        assertTrue(ctoTreasury.isSupportedAsset(address(asset)));

        asset.mint(address(ctoTreasury), 10 ether);
        controller.transferAsset(ctoTreasury, address(asset), buyer, 4 ether);
        assertEq(asset.balanceOf(buyer), 4 ether);
        vm.deal(address(ctoTreasury), 2 ether);
        uint256 buyerBefore = buyer.balance;
        controller.transferAsset(ctoTreasury, address(0), buyer, 1 ether);
        assertEq(buyer.balance - buyerBefore, 1 ether);
    }

    function testMalformedDuplicateAndUnsupportedAssetsRejected() public {
        _activate();
        vm.expectRevert(ICTOTreasuryV3.InvalidAsset.selector);
        controller.registerAsset(ctoTreasury, address(0));
        vm.expectRevert(ICTOTreasuryV3.InvalidAsset.selector);
        controller.registerAsset(ctoTreasury, buyer);
        vm.expectRevert(ICTOTreasuryV3.InvalidAsset.selector);
        controller.registerAsset(ctoTreasury, address(token));
        vm.expectRevert(ICTOTreasuryV3.UnsupportedAsset.selector);
        controller.transferAsset(ctoTreasury, buyer, creator, 1);
    }

    function testNativeFailureRollsBack() public {
        _activate();
        RejectingNativeRecipientV3 rejecting = new RejectingNativeRecipientV3();
        vm.deal(address(ctoTreasury), 1 ether);
        vm.expectRevert(ICTOTreasuryV3.NativeTransferFailed.selector);
        controller.transferAsset(ctoTreasury, address(0), address(rejecting), 1 ether);
        assertEq(address(ctoTreasury).balance, 1 ether);
    }

    function testCanonicalERC20FailureRollsBack() public {
        _activate();
        canonicalUsdc.mint(address(ctoTreasury), 10);
        canonicalUsdc.setRevertTransfers(true);
        vm.expectRevert(bytes("USDC_TRANSFER_REVERTED"));
        controller.transferAsset(ctoTreasury, ArcNativeUsdcV3.CANONICAL_USDC, buyer, 10);
        assertEq(canonicalUsdc.balanceOf(address(ctoTreasury)), 10);
    }

    function testPermissionlessCurveFeePullAlwaysPaysTreasury() public {
        _activate();
        _buy(buyer, curve, 0.1 ether);
        uint256 accrued = feeManager.creatorFeesAccrued(address(token));
        uint256 beforeBalance = address(ctoTreasury).balance;
        vm.prank(buyer);
        uint256 pulled = ctoTreasury.pullCurveCreatorFees();
        assertEq(pulled, accrued);
        assertEq(address(ctoTreasury).balance - beforeBalance, accrued);
    }

    function testLPFeePullRestrictedToCanonicalPair() public {
        _activate();
        MockSupportedAssetV3 asset = new MockSupportedAssetV3();
        controller.registerAsset(ctoTreasury, address(asset));
        vm.expectRevert(ICTOTreasuryV3.UnsupportedAsset.selector);
        ctoTreasury.pullLPCreatorFees(address(asset));
    }

    function testNoArbitraryExecutionOrApprovalSelectors() public {
        (bool executeSuccess,) = address(ctoTreasury).call(abi.encodeWithSignature("execute(address,bytes)", buyer, ""));
        (bool approveSuccess,) = address(ctoTreasury)
            .call(abi.encodeWithSignature("approve(address,address,uint256)", address(token), buyer, 1));
        assertFalse(executeSuccess);
        assertFalse(approveSuccess);
    }

    function _activate() private {
        controller.accept(ctoTreasury, proposalId);
        vm.warp(block.timestamp + 72 hours);
        registry.executeCTO(proposalId);
    }
}
