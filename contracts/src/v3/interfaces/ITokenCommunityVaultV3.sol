// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITokenCommunityVaultV3 {
    error InvalidAmount();
    error InvalidDependency();
    error InsufficientBacking(address asset, uint256 available, uint256 required);
    error InvalidTreasury();
    error LPFeeVaultAlreadySet();
    error NativeTransferFailed();
    error NoPendingProposal();
    error NothingToForward();
    error TreasuryDelayNotElapsed();
    error TreasuryUnchanged();
    error UnauthorizedBootstrap();
    error UnauthorizedFundingSource();
    error UnauthorizedPendingTreasury();

    event PermanentLPFeeVaultSet(address indexed vault);
    event CommunityFunded(address indexed launchToken, address indexed asset, address indexed source, uint256 amount);
    event CommunityFundsForwarded(
        address indexed launchToken, address indexed asset, address indexed treasury, uint256 amount, address caller
    );
    event TreasuryProposed(address indexed currentTreasury, address indexed proposedTreasury, uint64 acceptAfter);
    event TreasuryAccepted(address indexed previousTreasury, address indexed newTreasury);
    event TreasuryProposalCancelled(address indexed cancelledTreasury);
    event TreasuryProposalInvalidated(address indexed cancelledTreasury, address indexed newOwner);

    function setPermanentLPFeeVaultOnce(address vault) external;
    function depositNative(address launchToken) external payable;
    function recordERC20Funding(address launchToken, address asset, uint256 amount) external;
    function forwardToTreasury(address launchToken, address asset) external returns (uint256 amount);
    function proposeTreasury(address proposedTreasury) external;
    function acceptTreasury() external;
    function cancelTreasuryProposal() external;

    function protocolVersionHash() external pure returns (bytes32);
    function feePolicyHash() external pure returns (bytes32);
    function feeManager() external view returns (address);
    function permanentLPFeeVault() external view returns (address);
    function lpFeeVaultBootstrapAuthority() external view returns (address);
    function treasury() external view returns (address);
    function pendingTreasury() external view returns (address);
    function pendingTreasuryAcceptAfter() external view returns (uint64);
    function accrued(address launchToken, address asset) external view returns (uint256);
    function totalAccrued(address asset) external view returns (uint256);
}
