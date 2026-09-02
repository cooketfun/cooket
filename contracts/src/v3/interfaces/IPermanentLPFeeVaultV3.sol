// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPermanentLPFeeVaultV3 {
    error CustodianDeployerAlreadySet();
    error InsufficientLPFeeBacking(address asset, uint256 available, uint256 required);
    error InvalidCustodianDeployer();
    error InvalidLPFeeAsset();
    error InvalidEcosystemVault();
    error NothingToClaimLPFees();
    error UnauthorizedBootstrap();
    error UnauthorizedPermanentCustodian();

    event PermanentLPCustodianDeployerSet(address indexed deployer);
    event PermanentLPFeesAccrued(
        address indexed launchToken,
        address indexed custodian,
        address indexed asset,
        address protocolRecipient,
        address creatorRecipient,
        uint256 creatorShare,
        uint256 protocolShare,
        uint256 communityShare,
        uint256 traderRewardsShare
    );
    event ProtocolLPFeesClaimed(address indexed recipient, address indexed asset, uint256 amount);
    event CreatorLPFeesClaimed(address indexed recipient, address indexed asset, uint256 amount);
    event CommunityLPFeesForwarded(
        address indexed launchToken, address indexed asset, address indexed vault, uint256 amount, address caller
    );
    event TraderRewardsLPFeesForwarded(
        address indexed launchToken, address indexed asset, address indexed vault, uint256 amount, address caller
    );

    function setPermanentLPCustodianDeployerOnce(address deployer) external;
    function notifyPermanentLPFees(address launchToken, uint256 amount0, uint256 amount1) external;
    function claimLPFees(address asset) external returns (uint256 protocolAmount, uint256 creatorAmount);
    function fundCommunityVault(address launchToken, address asset) external returns (uint256 amount);
    function fundTraderRewardsVault(address launchToken, address asset) external returns (uint256 amount);

    function protocolVersionHash() external pure returns (bytes32);
    function feePolicyHash() external pure returns (bytes32);
    function factory() external view returns (address);
    function feeManager() external view returns (address);
    function graduationManager() external view returns (address);
    function canonicalUsdc() external view returns (address);
    function communityVault() external view returns (address);
    function traderRewardsVault() external view returns (address);
    function permanentLPCustodianDeployer() external view returns (address);
    function custodianDeployerBootstrapAuthority() external view returns (address);
    function protocolLPFeesAccrued(address recipient, address asset) external view returns (uint256);
    function creatorLPFeesAccrued(address recipient, address asset) external view returns (uint256);
    function communityLPFeesAccrued(address launchToken, address asset) external view returns (uint256);
    function traderRewardsLPFeesAccrued(address launchToken, address asset) external view returns (uint256);
    function totalLPFeesAccrued(address asset) external view returns (uint256);
}
