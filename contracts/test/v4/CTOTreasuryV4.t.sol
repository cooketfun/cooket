// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CTORegistryV4} from "../../src/v4/CTORegistryV4.sol";
import {CTOTreasuryV4} from "../../src/v4/CTOTreasuryV4.sol";
import {ICTOTreasuryV4} from "../../src/v4/interfaces/ICTOTreasuryV4.sol";
import {CooketV4TestBase} from "./helpers/CooketV4TestBase.sol";
import {MockCTOControllerV4} from "./mocks/MockCTOControllerV4.sol";

contract MockSupportedAssetV4 is ERC20 {
    constructor() ERC20("Supported", "SUP") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract RejectingNativeRecipientV4 {
    receive() external payable {
        revert("REJECT");
    }
}

contract CTOTreasuryV4Test is CooketV4TestBase {
    CTORegistryV4 internal registry;
    MockCTOControllerV4 internal controller;
    CTOTreasuryV4 internal ctoTreasury;
    bytes32 internal proposalId;

    function setUp() public override {
        super.setUp();
        registry = CTORegistryV4(feeManager.ctoRegistry());
        controller = new MockCTOControllerV4();
        vm.prank(creator);
        address treasuryAddress;
        (proposalId, treasuryAddress) =
            registry.proposeCTO(address(token), address(controller), bytes32(0), "ipfs://cto");
        ctoTreasury = CTOTreasuryV4(payable(treasuryAddress));
    }

    function testImmutableRelationshipsBuiltinsAndControllerOnlyConfirmation() public {
        assertEq(ctoTreasury.registry(), address(registry));
        assertEq(ctoTreasury.protocolVersionHash(), keccak256("endpoint-cp-v4"));
        assertEq(ctoTreasury.launchToken(), address(token));
        assertEq(ctoTreasury.controller(), address(controller));
        assertEq(ctoTreasury.canonicalUsdc(), address(0x8000000000000000000000000000000000000001));
        assertTrue(ctoTreasury.isSupportedAsset(address(0)));
        assertTrue(ctoTreasury.isSupportedAsset(address(token)));
        assertTrue(ctoTreasury.isSupportedAsset(address(0x8000000000000000000000000000000000000001)));
        vm.expectRevert(ICTOTreasuryV4.UnauthorizedController.selector);
        ctoTreasury.confirmCTO(proposalId);
        controller.accept(ctoTreasury, proposalId);
    }

    function testDisbursementBlockedBeforeActivationAndRestrictedToController() public {
        vm.deal(address(ctoTreasury), 1 ether);
        vm.expectRevert(ICTOTreasuryV4.UnauthorizedController.selector);
        ctoTreasury.transferAsset(address(0), buyer, 1);
        vm.expectRevert(ICTOTreasuryV4.CTOInactive.selector);
        controller.transferAsset(ctoTreasury, address(0), buyer, 1);
    }

    function testAdditionalAssetRegistrationAndNativeERC20Disbursement() public {
        _activate();
        MockSupportedAssetV4 asset = new MockSupportedAssetV4();
        vm.expectRevert(ICTOTreasuryV4.UnauthorizedController.selector);
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
        vm.expectRevert(ICTOTreasuryV4.InvalidAsset.selector);
        controller.registerAsset(ctoTreasury, address(0));
        vm.expectRevert(ICTOTreasuryV4.InvalidAsset.selector);
        controller.registerAsset(ctoTreasury, buyer);
        vm.expectRevert(ICTOTreasuryV4.InvalidAsset.selector);
        controller.registerAsset(ctoTreasury, address(token));
        vm.expectRevert(ICTOTreasuryV4.UnsupportedAsset.selector);
        controller.transferAsset(ctoTreasury, buyer, creator, 1);
    }

    function testNativeFailureRollsBack() public {
        _activate();
        RejectingNativeRecipientV4 rejecting = new RejectingNativeRecipientV4();
        vm.deal(address(ctoTreasury), 1 ether);
        vm.expectRevert(ICTOTreasuryV4.NativeTransferFailed.selector);
        controller.transferAsset(ctoTreasury, address(0), address(rejecting), 1 ether);
        assertEq(address(ctoTreasury).balance, 1 ether);
    }

    function testCanonicalERC20FailureRollsBack() public {
        _activate();
        canonicalUsdc.mint(address(ctoTreasury), 10);
        canonicalUsdc.setRevertTransfers(true);
        vm.expectRevert(bytes("USDC_TRANSFER_REVERTED"));
        controller.transferAsset(ctoTreasury, address(0x8000000000000000000000000000000000000001), buyer, 10);
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
        MockSupportedAssetV4 asset = new MockSupportedAssetV4();
        controller.registerAsset(ctoTreasury, address(asset));
        vm.expectRevert(ICTOTreasuryV4.UnsupportedAsset.selector);
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
    }
}
