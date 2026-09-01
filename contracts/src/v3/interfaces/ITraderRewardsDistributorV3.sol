// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITraderRewardsDistributorV3 {
    error AlreadyClaimed();
    error DistributionAlreadyPublished();
    error DistributionNotPublished();
    error InvalidAmount();
    error InvalidDependency();
    error InvalidMerkleProof();
    error InvalidRoot();
    error InvalidToken();

    event DistributionPublished(
        bytes32 indexed distributionId, uint256 indexed epoch, address indexed launchToken, address asset, bytes32 root
    );
    event RewardClaimed(
        bytes32 indexed distributionId,
        uint256 indexed epoch,
        address indexed launchToken,
        address asset,
        address claimant,
        uint256 amount
    );

    function publishRoot(uint256 epoch, address launchToken, address asset, bytes32 root) external returns (bytes32 id);
    function claim(uint256 epoch, address launchToken, address asset, uint256 amount, bytes32[] calldata proof) external;
    function distributionId(uint256 epoch, address launchToken, address asset) external pure returns (bytes32);
    function leafHash(bytes32 id, address claimant, uint256 amount) external pure returns (bytes32);

    function protocolVersionHash() external pure returns (bytes32);
    function feePolicyHash() external pure returns (bytes32);
    function rewardsVault() external view returns (address);
    function roots(bytes32 id) external view returns (bytes32);
    function claimed(bytes32 id, address claimant) external view returns (bool);
}
