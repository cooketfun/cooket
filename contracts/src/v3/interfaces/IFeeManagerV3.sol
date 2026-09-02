// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFeeManagerV3 {
    error CreatorPayoutUnchanged();
    error FactoryAlreadySet();
    error FactoryNotSet();
    error InvalidCreator();
    error InvalidCurve();
    error InvalidFactory();
    error InvalidFeeValue();
    error InvalidFeeSplit();
    error EcosystemVaultsAlreadySet();
    error EcosystemVaultsNotSet();
    error InvalidEcosystemVault();
    error InvalidPayoutRecipient();
    error InvalidToken();
    error InvalidTreasury();
    error NativeTransferFailed();
    error NothingToClaim();
    error NothingToFund();
    error TokenAlreadyRegistered();
    error TreasuryDelayNotElapsed();
    error TreasuryUnchanged();
    error UnauthorizedCreator();
    error UnauthorizedCurve();
    error UnauthorizedFactory();
    error UnauthorizedPendingPayout();
    error UnauthorizedPendingTreasury();
    error UnexpectedEther();
    error NoPendingProposal();
    error UnauthorizedBootstrap();
    error FactoryVersionMismatch();
    error TokenRelationshipMismatch();
    error CTOAlreadyActive();
    error CTOActive();
    error InvalidCTOTreasury();
    error UnauthorizedCTORegistry();

    event FactorySet(address indexed factory);
    event FactoryBootstrapConsumed(address indexed previousBootstrapAuthority);
    event TokenRegistered(address indexed token, address indexed curve, address indexed creator, address payout);
    event FeesDeposited(
        address indexed token,
        address indexed curve,
        bool indexed isBuy,
        uint256 totalFee,
        uint256 creatorFee,
        uint256 protocolFee,
        uint256 communityFee,
        uint256 traderRewardsFee
    );
    event EcosystemVaultsSet(address indexed communityVault, address indexed traderRewardsVault);
    event CommunityVaultFunded(address indexed token, address indexed vault, uint256 amount, address caller);
    event TraderRewardsVaultFunded(address indexed token, address indexed vault, uint256 amount, address caller);
    event CreatorPayoutProposed(address indexed token, address indexed currentPayout, address indexed proposedPayout);
    event CreatorPayoutAccepted(address indexed token, address indexed previousPayout, address indexed newPayout);
    event CreatorPayoutCancelled(address indexed token, address indexed cancelledPayout);
    event TreasuryProposed(address indexed currentTreasury, address indexed proposedTreasury, uint64 acceptAfter);
    event TreasuryAccepted(address indexed previousTreasury, address indexed newTreasury);
    event TreasuryProposalCancelled(address indexed cancelledTreasury);
    event TreasuryProposalInvalidated(address indexed cancelledTreasury, address indexed newOwner);
    event ProtocolFeesClaimed(address indexed treasury, address indexed triggeredBy, uint256 amount);
    event CreatorFeesClaimed(
        address indexed token, address indexed payout, address indexed triggeredBy, uint256 amount
    );
    event CreatorFeeCheckpointed(address indexed token, address indexed previousRecipient, uint256 amount);
    event PendingCreatorPayoutInvalidated(address indexed token, address indexed cancelledPayout);
    event CTOFeeRouteActivated(address indexed token, address indexed previousRecipient, address indexed treasury);
    event CheckpointedCreatorFeesClaimed(
        address indexed token, address indexed recipient, address indexed triggeredBy, uint256 amount
    );

    function setFactoryOnce(address factory_) external;
    function bindEcosystemVaultsOnce(address communityVault, address traderRewardsVault) external;
    function registerToken(address token, address curve, address creator) external;
    function depositFees(
        address token,
        uint256 totalFee,
        uint256 creatorFee,
        uint256 protocolFee,
        uint256 communityFee,
        uint256 traderRewardsFee,
        bool isBuy
    ) external payable;
    function proposeCreatorPayout(address token, address proposedPayout) external;
    function acceptCreatorPayout(address token) external;
    function cancelCreatorPayout(address token) external;
    function proposeTreasury(address proposedTreasury) external;
    function acceptTreasury() external;
    function cancelTreasuryProposal() external;
    function claimProtocolFees() external returns (uint256 amount);
    function claimCreatorFees(address token) external returns (uint256 amount);
    function activateCTO(address token, address treasury) external;
    function claimCheckpointedCreatorFees(address token, address recipient) external returns (uint256 amount);
    function fundCommunityVault(address token) external returns (uint256 amount);
    function fundTraderRewardsVault(address token) external returns (uint256 amount);

    function factory() external view returns (address);
    function factoryBootstrapAuthority() external view returns (address);
    function ecosystemBootstrapAuthority() external view returns (address);
    function protocolVersionHash() external pure returns (bytes32);
    function feePolicyHash() external pure returns (bytes32);
    function treasury() external view returns (address);
    function pendingTreasury() external view returns (address);
    function pendingTreasuryAcceptAfter() external view returns (uint64);
    function curveOf(address token) external view returns (address);
    function creatorOf(address token) external view returns (address);
    function creatorPayoutOf(address token) external view returns (address);
    function pendingCreatorPayoutOf(address token) external view returns (address);
    function protocolFeesAccrued() external view returns (uint256);
    function creatorFeesAccrued(address token) external view returns (uint256);
    function totalCreatorFeesAccrued() external view returns (uint256);
    function communityFeesAccrued() external view returns (uint256);
    function traderRewardsFeesAccrued() external view returns (uint256);
    function communityFeesAccruedByToken(address token) external view returns (uint256);
    function traderRewardsFeesAccruedByToken(address token) external view returns (uint256);
    function communityVault() external view returns (address);
    function traderRewardsVault() external view returns (address);
    function ctoRegistry() external view returns (address);
    function ctoActive(address token) external view returns (bool);
    function ctoTreasuryOf(address token) external view returns (address);
    function checkpointedCreatorFees(address token, address recipient) external view returns (uint256);
    function ctoPolicyHash() external pure returns (bytes32);
    function totalLiabilities() external view returns (uint256);
}
