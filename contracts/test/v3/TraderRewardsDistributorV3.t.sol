// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITraderRewardsDistributorV3} from "../../src/v3/interfaces/ITraderRewardsDistributorV3.sol";
import {ITraderRewardsVaultV3} from "../../src/v3/interfaces/ITraderRewardsVaultV3.sol";
import {TraderRewardsDistributorV3} from "../../src/v3/TraderRewardsDistributorV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";

contract TraderRewardsDistributorV3Test is CooketV3TestBase {
    address internal claimantTwo = makeAddr("claimantTwo");

    function testVaultAndDistributorBindingsAndFundingSourcesAreFixed() public {
        assertEq(rewardsVault.distributor(), address(rewardsDistributor));
        assertEq(rewardsVault.permanentLPFeeVault(), address(lpFeeVault));
        assertEq(rewardsVault.bootstrapAuthority(), address(0));
        assertEq(rewardsVault.protocolVersionHash(), keccak256("endpoint-cp-v3"));
        assertEq(rewardsVault.feePolicyHash(), keccak256("cooket-fee-design-b-v3"));
        assertEq(rewardsDistributor.protocolVersionHash(), keccak256("endpoint-cp-v3"));
        assertEq(rewardsDistributor.feePolicyHash(), keccak256("cooket-fee-design-b-v3"));

        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsVaultV3.UnauthorizedFundingSource.selector);
        rewardsVault.depositNative{value: 1}(address(token));
        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsVaultV3.UnauthorizedFundingSource.selector);
        rewardsVault.recordERC20Funding(address(token), address(canonicalUsdc), 1);
        vm.prank(address(lpFeeVault));
        vm.expectRevert(
            abi.encodeWithSelector(
                ITraderRewardsVaultV3.InsufficientBacking.selector, address(canonicalUsdc), uint256(0), uint256(1)
            )
        );
        rewardsVault.recordERC20Funding(address(token), address(canonicalUsdc), 1);

        (bool ok,) = address(rewardsVault)
            .call(abi.encodeWithSignature("withdraw(address,address,uint256)", buyer, address(canonicalUsdc), 1));
        assertFalse(ok);
    }

    function testValidMerkleClaimsPayAuthenticatedClaimantsAndRejectReplay() public {
        _buy(buyer, curve, 0.1 ether);
        feeManager.fundTraderRewardsVault(address(token));
        uint256 amountOne = 100_000_000_000_000;
        uint256 amountTwo = 50_000_000_000_000;
        bytes32 id = rewardsDistributor.distributionId(1, address(token), address(0));
        bytes32 leafOne = rewardsDistributor.leafHash(id, buyer, amountOne);
        bytes32 leafTwo = rewardsDistributor.leafHash(id, claimantTwo, amountTwo);
        rewardsDistributor.publishRoot(1, address(token), address(0), _hashPair(leafOne, leafTwo));

        bytes32[] memory proofOne = new bytes32[](1);
        proofOne[0] = leafTwo;
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        rewardsDistributor.claim(1, address(token), address(0), amountOne, proofOne);
        assertEq(buyer.balance - buyerBefore, amountOne);

        bytes32[] memory proofTwo = new bytes32[](1);
        proofTwo[0] = leafOne;
        vm.prank(claimantTwo);
        rewardsDistributor.claim(1, address(token), address(0), amountTwo, proofTwo);
        assertEq(claimantTwo.balance, amountTwo);
        assertEq(rewardsVault.accrued(address(token), address(0)), 0);

        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsDistributorV3.AlreadyClaimed.selector);
        rewardsDistributor.claim(1, address(token), address(0), amountOne, proofOne);
    }

    function testInvalidProofAndWrongDistributionDimensionsRevert() public {
        bytes32 id = rewardsDistributor.distributionId(7, address(token), address(0));
        bytes32 root = rewardsDistributor.leafHash(id, buyer, 1 ether);
        rewardsDistributor.publishRoot(7, address(token), address(0), root);
        bytes32[] memory emptyProof = new bytes32[](0);

        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsDistributorV3.InvalidMerkleProof.selector);
        rewardsDistributor.claim(7, address(token), address(0), 1 ether - 1, emptyProof);
        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsDistributorV3.DistributionNotPublished.selector);
        rewardsDistributor.claim(8, address(token), address(0), 1 ether, emptyProof);
        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsDistributorV3.DistributionNotPublished.selector);
        rewardsDistributor.claim(7, buyer, address(0), 1 ether, emptyProof);
        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsDistributorV3.DistributionNotPublished.selector);
        rewardsDistributor.claim(7, address(token), address(canonicalUsdc), 1 ether, emptyProof);
        vm.prank(claimantTwo);
        vm.expectRevert(ITraderRewardsDistributorV3.InvalidMerkleProof.selector);
        rewardsDistributor.claim(7, address(token), address(0), 1 ether, emptyProof);
    }

    function testRootPublicationIsGovernedAndImmutable() public {
        bytes32 root = keccak256("root");
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        rewardsDistributor.publishRoot(1, address(token), address(0), root);
        vm.expectRevert(ITraderRewardsDistributorV3.InvalidRoot.selector);
        rewardsDistributor.publishRoot(1, address(token), address(0), bytes32(0));
        rewardsDistributor.publishRoot(1, address(token), address(0), root);
        vm.expectRevert(ITraderRewardsDistributorV3.DistributionAlreadyPublished.selector);
        rewardsDistributor.publishRoot(1, address(token), address(0), keccak256("replacement"));
    }

    function testInsufficientFundingRevertsClaimWithoutBurningAuthorization() public {
        uint256 amount = 1 ether;
        bytes32 id = rewardsDistributor.distributionId(2, address(token), address(0));
        rewardsDistributor.publishRoot(2, address(token), address(0), rewardsDistributor.leafHash(id, buyer, amount));
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsVaultV3.InsufficientRewardsBalance.selector);
        rewardsDistributor.claim(2, address(token), address(0), amount, proof);
        assertFalse(rewardsDistributor.claimed(id, buyer));
    }

    function testPooledBalanceOvercommitStarvesLaterClaimantUntilRefunded() public {
        _buy(buyer, curve, 0.1 ether);
        feeManager.fundTraderRewardsVault(address(token));
        uint256 funded = rewardsVault.accrued(address(token), address(0));
        assertEq(funded, 150_000_000_000_000);

        uint256 firstClaim = 100_000_000_000_000;
        uint256 secondClaim = 100_000_000_000_000;
        bytes32 idA = rewardsDistributor.distributionId(1, address(token), address(0));
        bytes32 idB = rewardsDistributor.distributionId(2, address(token), address(0));
        rewardsDistributor.publishRoot(
            1, address(token), address(0), rewardsDistributor.leafHash(idA, buyer, firstClaim)
        );
        rewardsDistributor.publishRoot(
            2, address(token), address(0), rewardsDistributor.leafHash(idB, claimantTwo, secondClaim)
        );

        bytes32[] memory emptyProof = new bytes32[](0);
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        rewardsDistributor.claim(1, address(token), address(0), firstClaim, emptyProof);
        assertEq(buyer.balance - buyerBefore, firstClaim);
        assertTrue(rewardsDistributor.claimed(idA, buyer));
        assertEq(rewardsVault.accrued(address(token), address(0)), funded - firstClaim);

        vm.prank(claimantTwo);
        vm.expectRevert(ITraderRewardsVaultV3.InsufficientRewardsBalance.selector);
        rewardsDistributor.claim(2, address(token), address(0), secondClaim, emptyProof);
        assertFalse(rewardsDistributor.claimed(idB, claimantTwo));

        _buy(buyer, curve, 0.1 ether);
        feeManager.fundTraderRewardsVault(address(token));
        uint256 claimantBefore = claimantTwo.balance;
        vm.prank(claimantTwo);
        rewardsDistributor.claim(2, address(token), address(0), secondClaim, emptyProof);
        assertEq(claimantTwo.balance - claimantBefore, secondClaim);
        assertTrue(rewardsDistributor.claimed(idB, claimantTwo));
    }

    function testMaliciousReceiverCannotReenterOrKeepAuthorizationOnFailedPayout() public {
        _buy(buyer, curve, 0.1 ether);
        feeManager.fundTraderRewardsVault(address(token));
        uint256 amount = 50_000_000_000_000;
        ReentrantRewardClaimantV3 attacker = new ReentrantRewardClaimantV3(rewardsDistributor);
        bytes32 id = rewardsDistributor.distributionId(4, address(token), address(0));
        rewardsDistributor.publishRoot(
            4, address(token), address(0), rewardsDistributor.leafHash(id, address(attacker), amount)
        );

        attacker.setRejectPayment(true);
        vm.expectRevert(ITraderRewardsVaultV3.NativeTransferFailed.selector);
        attacker.claim(4, address(token), address(0), amount);
        assertFalse(rewardsDistributor.claimed(id, address(attacker)));
        assertEq(rewardsVault.accrued(address(token), address(0)), 150_000_000_000_000);

        attacker.setRejectPayment(false);
        uint256 attackerBefore = address(attacker).balance;
        attacker.claim(4, address(token), address(0), amount);
        assertFalse(attacker.reentrySucceeded());
        assertEq(address(attacker).balance - attackerBefore, amount);
        assertTrue(rewardsDistributor.claimed(id, address(attacker)));
    }

    function testERC20RewardClaimAndOnlyDistributorPayout() public {
        uint256 amount = 2_000_000;
        canonicalUsdc.mint(address(rewardsVault), amount);
        vm.prank(address(lpFeeVault));
        rewardsVault.recordERC20Funding(address(token), address(canonicalUsdc), amount);
        vm.prank(buyer);
        vm.expectRevert(ITraderRewardsVaultV3.UnauthorizedDistributor.selector);
        rewardsVault.payout(address(token), address(canonicalUsdc), buyer, amount);

        bytes32 id = rewardsDistributor.distributionId(3, address(token), address(canonicalUsdc));
        rewardsDistributor.publishRoot(
            3, address(token), address(canonicalUsdc), rewardsDistributor.leafHash(id, buyer, amount)
        );
        bytes32[] memory proof = new bytes32[](0);
        uint256 buyerUsdcBefore = canonicalUsdc.balanceOf(buyer);
        vm.prank(buyer);
        rewardsDistributor.claim(3, address(token), address(canonicalUsdc), amount, proof);
        assertEq(canonicalUsdc.balanceOf(buyer) - buyerUsdcBefore, amount);
        assertEq(rewardsVault.accrued(address(token), address(canonicalUsdc)), 0);
        assertEq(rewardsVault.totalAccrued(address(canonicalUsdc)), 0);
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(bytes.concat(a, b)) : keccak256(bytes.concat(b, a));
    }
}

contract ReentrantRewardClaimantV3 {
    TraderRewardsDistributorV3 public immutable distributor;
    bool public rejectPayment;
    bool public reentrySucceeded;

    constructor(TraderRewardsDistributorV3 distributor_) {
        distributor = distributor_;
    }

    function setRejectPayment(bool rejectPayment_) external {
        rejectPayment = rejectPayment_;
    }

    function claim(uint256 epoch, address launchToken, address asset, uint256 amount) external {
        bytes32[] memory proof = new bytes32[](0);
        distributor.claim(epoch, launchToken, asset, amount, proof);
    }

    receive() external payable {
        if (rejectPayment) revert("REJECT_REWARD");
        bytes32[] memory proof = new bytes32[](0);
        (reentrySucceeded,) = address(distributor)
            .call(abi.encodeCall(TraderRewardsDistributorV3.claim, (4, address(0), address(0), uint256(1), proof)));
    }
}
