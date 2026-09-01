// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITokenCommunityVaultV3} from "../../src/v3/interfaces/ITokenCommunityVaultV3.sol";
import {TokenCommunityVaultV3} from "../../src/v3/TokenCommunityVaultV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";

contract CommunityTreasuryReceiverV3 {
    function acceptTreasury(TokenCommunityVaultV3 vault) external {
        vault.acceptTreasury();
    }

    receive() external payable {}
}

contract TokenCommunityVaultV3Test is CooketV3TestBase {
    function testCanonicalBindingsVersionsAndNoArbitraryWithdrawalSurface() public {
        assertEq(communityVault.feeManager(), address(feeManager));
        assertEq(communityVault.permanentLPFeeVault(), address(lpFeeVault));
        assertEq(communityVault.lpFeeVaultBootstrapAuthority(), address(0));
        assertEq(communityVault.protocolVersionHash(), keccak256("endpoint-cp-v3"));
        assertEq(communityVault.feePolicyHash(), keccak256("cooket-fee-design-b-v3"));
        (bool ok,) = address(communityVault)
            .call(abi.encodeWithSignature("withdraw(address,address,uint256)", buyer, address(weth), 1));
        assertFalse(ok);
    }

    function testNativeFundingPreservesLaunchTokenProvenanceAndExactBacking() public {
        _buy(buyer, curve, 0.1 ether);
        uint256 amount = feeManager.communityFeesAccruedByToken(address(token));
        vm.prank(buyer);
        feeManager.fundCommunityVault(address(token));

        assertEq(amount, 200_000_000_000_000);
        assertEq(communityVault.accrued(address(token), address(0)), amount);
        assertEq(communityVault.totalAccrued(address(0)), amount);
        assertEq(address(communityVault).balance, amount);
        assertEq(feeManager.communityFeesAccruedByToken(address(token)), 0);
        assertEq(feeManager.communityFeesAccrued(), 0);
    }

    function testERC20FundingRequiresCanonicalLPVaultAndExactBacking() public {
        vm.expectRevert(ITokenCommunityVaultV3.UnauthorizedFundingSource.selector);
        communityVault.recordERC20Funding(address(token), address(weth), 1 ether);

        vm.prank(address(lpFeeVault));
        vm.expectRevert(
            abi.encodeWithSelector(
                ITokenCommunityVaultV3.InsufficientBacking.selector, address(weth), uint256(0), uint256(1 ether)
            )
        );
        communityVault.recordERC20Funding(address(token), address(weth), 1 ether);

        weth.mint(address(communityVault), 1 ether);
        vm.prank(address(lpFeeVault));
        communityVault.recordERC20Funding(address(token), address(weth), 1 ether);
        vm.prank(address(curve));
        assertTrue(token.transfer(address(communityVault), 2 ether));
        vm.prank(address(lpFeeVault));
        communityVault.recordERC20Funding(address(token), address(token), 2 ether);

        assertEq(communityVault.accrued(address(token), address(weth)), 1 ether);
        assertEq(communityVault.accrued(address(token), address(token)), 2 ether);
        assertEq(communityVault.totalAccrued(address(weth)), 1 ether);
        assertEq(communityVault.totalAccrued(address(token)), 2 ether);

        uint256 treasuryWethBefore = weth.balanceOf(treasury);
        vm.prank(buyer);
        communityVault.forwardToTreasury(address(token), address(weth));
        assertEq(weth.balanceOf(treasury) - treasuryWethBefore, 1 ether);
        assertEq(communityVault.accrued(address(token), address(weth)), 0);
        assertEq(communityVault.totalAccrued(address(weth)), 0);
    }

    function testCommunityTreasuryLifecycleAndPermissionlessForwardingCannotRedirect() public {
        _buy(buyer, curve, 0.1 ether);
        feeManager.fundCommunityVault(address(token));
        uint256 amount = communityVault.accrued(address(token), address(0));

        vm.expectRevert(ITokenCommunityVaultV3.InvalidTreasury.selector);
        communityVault.proposeTreasury(address(0));
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        communityVault.proposeTreasury(buyer);

        CommunityTreasuryReceiverV3 newTreasury = new CommunityTreasuryReceiverV3();
        communityVault.proposeTreasury(address(newTreasury));
        vm.expectRevert(ITokenCommunityVaultV3.TreasuryDelayNotElapsed.selector);
        newTreasury.acceptTreasury(communityVault);
        vm.warp(block.timestamp + 48 hours);
        newTreasury.acceptTreasury(communityVault);

        vm.prank(buyer);
        communityVault.forwardToTreasury(address(token), address(0));
        assertEq(address(newTreasury).balance, amount);
        assertEq(communityVault.accrued(address(token), address(0)), 0);
        assertEq(communityVault.totalAccrued(address(0)), 0);
        vm.expectRevert(ITokenCommunityVaultV3.NothingToForward.selector);
        communityVault.forwardToTreasury(address(token), address(0));
    }

    function testOwnerCanCancelPendingCommunityTreasuryProposal() public {
        communityVault.proposeTreasury(buyer);
        assertEq(communityVault.pendingTreasury(), buyer);
        communityVault.cancelTreasuryProposal();
        assertEq(communityVault.pendingTreasury(), address(0));
        assertEq(communityVault.pendingTreasuryAcceptAfter(), 0);
        assertEq(communityVault.treasury(), treasury);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(buyer);
        vm.expectRevert(ITokenCommunityVaultV3.UnauthorizedPendingTreasury.selector);
        communityVault.acceptTreasury();
    }

    function testPendingCommunityTreasuryIsInvalidatedWhenOwnershipTransfers() public {
        address newOwner = makeAddr("newCommunityOwner");
        communityVault.proposeTreasury(buyer);
        communityVault.transferOwnership(newOwner);
        vm.prank(newOwner);
        communityVault.acceptOwnership();

        assertEq(communityVault.owner(), newOwner);
        assertEq(communityVault.pendingTreasury(), address(0));
        assertEq(communityVault.pendingTreasuryAcceptAfter(), 0);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(buyer);
        vm.expectRevert(ITokenCommunityVaultV3.UnauthorizedPendingTreasury.selector);
        communityVault.acceptTreasury();
    }

    function testDirectNativeFundingAndCreatorControlAreRejected() public {
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(ITokenCommunityVaultV3.UnauthorizedFundingSource.selector);
        communityVault.depositNative{value: 1 ether}(address(token));

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, creator));
        communityVault.proposeTreasury(creator);
    }
}
