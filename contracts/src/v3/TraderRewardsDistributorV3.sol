// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ITraderRewardsDistributorV3} from "./interfaces/ITraderRewardsDistributorV3.sol";
import {ITraderRewardsVaultV3} from "./interfaces/ITraderRewardsVaultV3.sol";
import {EndpointConstantsV3} from "./libraries/EndpointConstantsV3.sol";

/// @notice Policy-agnostic immutable-root Merkle authorization for trader reward payouts.
/// @dev Operator invariant: for each (launchToken, asset), do not publish roots whose
/// still-unpaid authorized claims, plus previously published still-unpaid distributions,
/// exceed available or committed rewards funding. Roots are immutable. Vault balances are
/// pooled per (launchToken, asset) with no on-chain reservation. Overcommit can starve
/// later valid claimants; a failed claim does not burn authorization and may retry after
/// additional funding.
contract TraderRewardsDistributorV3 is ITraderRewardsDistributorV3, Ownable2Step, ReentrancyGuard {
    bytes32 private constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");

    address public immutable override rewardsVault;
    mapping(bytes32 id => bytes32 root) public override roots;
    mapping(bytes32 id => mapping(address claimant => bool value)) public override claimed;

    constructor(address governance, address rewardsVault_) Ownable(governance) {
        if (
            rewardsVault_ == address(0) || rewardsVault_.code.length == 0
                || ITraderRewardsVaultV3(rewardsVault_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ITraderRewardsVaultV3(rewardsVault_).feePolicyHash() != EndpointConstantsV3.FEE_POLICY_HASH
        ) revert InvalidDependency();
        rewardsVault = rewardsVault_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function feePolicyHash() external pure override returns (bytes32) {
        return EndpointConstantsV3.FEE_POLICY_HASH;
    }

    function publishRoot(uint256 epoch, address launchToken, address asset, bytes32 root)
        external
        override
        onlyOwner
        returns (bytes32 id)
    {
        if (launchToken == address(0)) revert InvalidToken();
        if (root == bytes32(0)) revert InvalidRoot();
        id = distributionId(epoch, launchToken, asset);
        if (roots[id] != bytes32(0)) revert DistributionAlreadyPublished();
        roots[id] = root;
        emit DistributionPublished(id, epoch, launchToken, asset, root);
    }

    function claim(uint256 epoch, address launchToken, address asset, uint256 amount, bytes32[] calldata proof)
        external
        override
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();
        bytes32 id = distributionId(epoch, launchToken, asset);
        bytes32 root = roots[id];
        if (root == bytes32(0)) revert DistributionNotPublished();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();
        if (!MerkleProof.verifyCalldata(proof, root, leafHash(id, msg.sender, amount))) {
            revert InvalidMerkleProof();
        }
        claimed[id][msg.sender] = true;
        ITraderRewardsVaultV3(rewardsVault).payout(launchToken, asset, msg.sender, amount);
        emit RewardClaimed(id, epoch, launchToken, asset, msg.sender, amount);
    }

    function distributionId(uint256 epoch, address launchToken, address asset) public pure override returns (bytes32) {
        return keccak256(abi.encode(epoch, launchToken, asset));
    }

    function leafHash(bytes32 id, address claimant, uint256 amount) public pure override returns (bytes32) {
        return keccak256(abi.encode(id, claimant, amount));
    }
}
