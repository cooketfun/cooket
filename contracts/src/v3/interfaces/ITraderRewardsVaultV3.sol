// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITraderRewardsVaultV3 {
    error DistributorAlreadySet();
    error InsufficientBacking(address asset, uint256 available, uint256 required);
    error InsufficientRewardsBalance();
    error InvalidAmount();
    error InvalidDependency();
    error LPFeeVaultAlreadySet();
    error NativeTransferFailed();
    error UnauthorizedBootstrap();
    error UnauthorizedDistributor();
    error UnauthorizedFundingSource();

    event DistributorSet(address indexed distributor);
    event PermanentLPFeeVaultSet(address indexed vault);
    event TraderRewardsFunded(
        address indexed launchToken, address indexed asset, address indexed source, uint256 amount
    );
    event TraderRewardPaid(
        address indexed launchToken, address indexed asset, address indexed claimant, uint256 amount
    );

    function setDistributorOnce(address distributor) external;
    function setPermanentLPFeeVaultOnce(address vault) external;
    function depositNative(address launchToken) external payable;
    function recordERC20Funding(address launchToken, address asset, uint256 amount) external;
    function payout(address launchToken, address asset, address claimant, uint256 amount) external;

    function protocolVersionHash() external pure returns (bytes32);
    function feePolicyHash() external pure returns (bytes32);
    function feeManager() external view returns (address);
    function distributor() external view returns (address);
    function permanentLPFeeVault() external view returns (address);
    function bootstrapAuthority() external view returns (address);
    function accrued(address launchToken, address asset) external view returns (uint256);
    function totalAccrued(address asset) external view returns (uint256);
}
