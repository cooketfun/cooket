// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeManagerV4} from "./interfaces/IFeeManagerV4.sol";
import {ICooketCurveV4} from "./interfaces/ICooketCurveV4.sol";
import {ICooketFactoryV4} from "./interfaces/ICooketFactoryV4.sol";
import {ICooketTokenV4} from "./interfaces/ICooketTokenV4.sol";
import {ITokenCommunityVaultV4} from "./interfaces/ITokenCommunityVaultV4.sol";
import {ITraderRewardsVaultV4} from "./interfaces/ITraderRewardsVaultV4.sol";
import {EndpointConstantsV4} from "./libraries/EndpointConstantsV4.sol";
import {ICTORegistryV4} from "./interfaces/ICTORegistryV4.sol";
import {CTORegistryV4} from "./CTORegistryV4.sol";

/// @notice Pull-based custody of endpoint curve ETH fees and recipient lifecycle only.
contract FeeManagerV4 is IFeeManagerV4, Ownable2Step, ReentrancyGuard {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v4");
    bytes32 public constant CTO_POLICY_HASH = keccak256("cooket-voluntary-cto-v2");
    uint64 public constant TREASURY_ROTATION_DELAY = 48 hours;

    address public override factory;
    address public override factoryBootstrapAuthority;
    address public override ecosystemBootstrapAuthority;
    address public override treasury;
    address public override pendingTreasury;
    uint64 public override pendingTreasuryAcceptAfter;
    mapping(address token => address curve) public override curveOf;
    mapping(address token => address creator) public override creatorOf;
    mapping(address token => address payout) public override creatorPayoutOf;
    mapping(address token => address payout) public override pendingCreatorPayoutOf;
    mapping(address token => uint256 amount) public override creatorFeesAccrued;
    uint256 public override protocolFeesAccrued;
    uint256 public override totalCreatorFeesAccrued;
    uint256 public override communityFeesAccrued;
    uint256 public override traderRewardsFeesAccrued;
    mapping(address token => uint256 amount) public override communityFeesAccruedByToken;
    mapping(address token => uint256 amount) public override traderRewardsFeesAccruedByToken;
    address public override communityVault;
    address public override traderRewardsVault;
    address public immutable override ctoRegistry;
    mapping(address token => bool active) public override ctoActive;
    mapping(address token => address treasury_) public override ctoTreasuryOf;
    mapping(address token => mapping(address recipient => uint256 amount)) public override checkpointedCreatorFees;
    mapping(address token => address treasury_) private _checkpointedCTOTreasuryOf;

    constructor(address governance, address initialTreasury) Ownable(governance) {
        if (initialTreasury == address(0)) revert InvalidTreasury();
        factoryBootstrapAuthority = governance;
        ecosystemBootstrapAuthority = governance;
        treasury = initialTreasury;
        ctoRegistry = address(new CTORegistryV4(address(this)));
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function feePolicyHash() external pure override returns (bytes32) {
        return EndpointConstantsV4.FEE_POLICY_HASH;
    }

    function ctoPolicyHash() external pure override returns (bytes32) {
        return CTO_POLICY_HASH;
    }

    function setFactoryOnce(address factory_) external override {
        if (factory != address(0)) revert FactoryAlreadySet();
        if (msg.sender != factoryBootstrapAuthority || factoryBootstrapAuthority == address(0)) {
            revert UnauthorizedBootstrap();
        }
        if (factory_ == address(0) || factory_.code.length == 0) revert InvalidFactory();
        if (ICooketFactoryV4(factory_).protocolVersionHash() != PROTOCOL_VERSION_HASH) revert FactoryVersionMismatch();
        address consumedAuthority = factoryBootstrapAuthority;
        factory = factory_;
        factoryBootstrapAuthority = address(0);
        emit FactorySet(factory_);
        emit FactoryBootstrapConsumed(consumedAuthority);
    }

    function bindEcosystemVaultsOnce(address communityVault_, address traderRewardsVault_) external override {
        if (communityVault != address(0) || traderRewardsVault != address(0)) revert EcosystemVaultsAlreadySet();
        if (msg.sender != ecosystemBootstrapAuthority || ecosystemBootstrapAuthority == address(0)) {
            revert UnauthorizedBootstrap();
        }
        if (
            communityVault_ == address(0) || traderRewardsVault_ == address(0) || communityVault_ == traderRewardsVault_
                || communityVault_.code.length == 0 || traderRewardsVault_.code.length == 0
                || ITokenCommunityVaultV4(communityVault_).feeManager() != address(this)
                || ITraderRewardsVaultV4(traderRewardsVault_).feeManager() != address(this)
                || ITokenCommunityVaultV4(communityVault_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ITraderRewardsVaultV4(traderRewardsVault_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ITokenCommunityVaultV4(communityVault_).feePolicyHash() != EndpointConstantsV4.FEE_POLICY_HASH
                || ITraderRewardsVaultV4(traderRewardsVault_).feePolicyHash() != EndpointConstantsV4.FEE_POLICY_HASH
        ) revert InvalidEcosystemVault();
        communityVault = communityVault_;
        traderRewardsVault = traderRewardsVault_;
        ecosystemBootstrapAuthority = address(0);
        emit EcosystemVaultsSet(communityVault_, traderRewardsVault_);
    }

    function registerToken(address token, address curve, address creator) external override {
        if (factory == address(0)) revert FactoryNotSet();
        if (msg.sender != factory) revert UnauthorizedFactory();
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        if (curve == address(0) || curve.code.length == 0) revert InvalidCurve();
        if (creator == address(0)) revert InvalidCreator();
        if (curveOf[token] != address(0)) revert TokenAlreadyRegistered();
        (address registeredCreator, address registeredCurve) = ICooketFactoryV4(factory).tokenInfo(token);
        if (
            !ICooketFactoryV4(factory).isToken(token) || ICooketFactoryV4(factory).curveOf(token) != curve
                || registeredCurve != curve || registeredCreator != creator
                || ICooketCurveV4(curve).factory() != factory || ICooketCurveV4(curve).token() != token
                || ICooketCurveV4(curve).creator() != creator || ICooketTokenV4(token).factory() != factory
                || ICooketTokenV4(token).creator() != creator || !ICooketTokenV4(token).initialized()
        ) revert TokenRelationshipMismatch();
        curveOf[token] = curve;
        creatorOf[token] = creator;
        creatorPayoutOf[token] = creator;
        emit TokenRegistered(token, curve, creator, creator);
    }

    function depositFees(
        address token,
        uint256 totalFee,
        uint256 creatorFee,
        uint256 protocolFee,
        uint256 communityFee,
        uint256 traderRewardsFee,
        bool isBuy
    ) external payable override {
        if (curveOf[token] != msg.sender) revert UnauthorizedCurve();
        if (msg.value != totalFee) revert InvalidFeeValue();
        uint256 remaining = totalFee;
        if (creatorFee > remaining) revert InvalidFeeSplit();
        remaining -= creatorFee;
        if (protocolFee > remaining) revert InvalidFeeSplit();
        remaining -= protocolFee;
        if (communityFee > remaining) revert InvalidFeeSplit();
        remaining -= communityFee;
        if (traderRewardsFee != remaining) revert InvalidFeeSplit();
        protocolFeesAccrued += protocolFee;
        creatorFeesAccrued[token] += creatorFee;
        totalCreatorFeesAccrued += creatorFee;
        communityFeesAccrued += communityFee;
        traderRewardsFeesAccrued += traderRewardsFee;
        communityFeesAccruedByToken[token] += communityFee;
        traderRewardsFeesAccruedByToken[token] += traderRewardsFee;
        emit FeesDeposited(token, msg.sender, isBuy, totalFee, creatorFee, protocolFee, communityFee, traderRewardsFee);
    }

    function proposeCreatorPayout(address token, address proposedPayout) external override {
        if (ctoActive[token] || _checkpointedCTOTreasuryOf[token] != address(0)) revert CTOActive();
        if (msg.sender != creatorOf[token]) revert UnauthorizedCreator();
        if (proposedPayout == address(0)) revert InvalidPayoutRecipient();
        if (proposedPayout == creatorPayoutOf[token]) revert CreatorPayoutUnchanged();
        pendingCreatorPayoutOf[token] = proposedPayout;
        emit CreatorPayoutProposed(token, creatorPayoutOf[token], proposedPayout);
    }

    function acceptCreatorPayout(address token) external override {
        if (ctoActive[token] || _checkpointedCTOTreasuryOf[token] != address(0)) revert CTOActive();
        address proposedPayout = pendingCreatorPayoutOf[token];
        if (msg.sender != proposedPayout || proposedPayout == address(0)) revert UnauthorizedPendingPayout();
        address previousPayout = creatorPayoutOf[token];
        creatorPayoutOf[token] = proposedPayout;
        delete pendingCreatorPayoutOf[token];
        emit CreatorPayoutAccepted(token, previousPayout, proposedPayout);
    }

    function cancelCreatorPayout(address token) external override {
        if (ctoActive[token] || _checkpointedCTOTreasuryOf[token] != address(0)) revert CTOActive();
        if (msg.sender != creatorOf[token]) revert UnauthorizedCreator();
        address cancelledPayout = pendingCreatorPayoutOf[token];
        if (cancelledPayout == address(0)) revert NoPendingProposal();
        delete pendingCreatorPayoutOf[token];
        emit CreatorPayoutCancelled(token, cancelledPayout);
    }

    function proposeTreasury(address proposedTreasury) external override onlyOwner {
        if (proposedTreasury == address(0)) revert InvalidTreasury();
        if (proposedTreasury == treasury) revert TreasuryUnchanged();
        uint64 acceptAfter = uint64(block.timestamp + TREASURY_ROTATION_DELAY);
        pendingTreasury = proposedTreasury;
        pendingTreasuryAcceptAfter = acceptAfter;
        emit TreasuryProposed(treasury, proposedTreasury, acceptAfter);
    }

    function acceptTreasury() external override {
        address proposedTreasury = pendingTreasury;
        if (msg.sender != proposedTreasury || proposedTreasury == address(0)) revert UnauthorizedPendingTreasury();
        if (block.timestamp < pendingTreasuryAcceptAfter) revert TreasuryDelayNotElapsed();
        address previousTreasury = treasury;
        treasury = proposedTreasury;
        delete pendingTreasury;
        delete pendingTreasuryAcceptAfter;
        emit TreasuryAccepted(previousTreasury, proposedTreasury);
    }

    function cancelTreasuryProposal() external override onlyOwner {
        address cancelledTreasury = pendingTreasury;
        if (cancelledTreasury == address(0)) revert NoPendingProposal();
        delete pendingTreasury;
        delete pendingTreasuryAcceptAfter;
        emit TreasuryProposalCancelled(cancelledTreasury);
    }

    function claimProtocolFees() external override nonReentrant returns (uint256 amount) {
        amount = protocolFeesAccrued;
        if (amount == 0) revert NothingToClaim();
        protocolFeesAccrued = 0;
        _sendNative(treasury, amount);
        emit ProtocolFeesClaimed(treasury, msg.sender, amount);
    }

    function claimCreatorFees(address token) external override nonReentrant returns (uint256 amount) {
        amount = creatorFeesAccrued[token];
        if (amount == 0) revert NothingToClaim();
        creatorFeesAccrued[token] = 0;
        totalCreatorFeesAccrued -= amount;
        address payout = creatorPayoutOf[token];
        _sendNative(payout, amount);
        emit CreatorFeesClaimed(token, payout, msg.sender, amount);
    }

    function checkpointCreatorFeesForCTO(address token, address ctoTreasury) external override {
        if (msg.sender != ctoRegistry) revert UnauthorizedCTORegistry();
        if (ctoActive[token]) revert CTOAlreadyActive();
        if (_checkpointedCTOTreasuryOf[token] != address(0)) revert CTOAlreadyActive();
        address previousRecipient = creatorPayoutOf[token];
        if (
            previousRecipient == address(0) || ctoTreasury == address(0) || ctoTreasury.code.length == 0
                || !ICTORegistryV4(ctoRegistry).isCanonicalTreasury(token, ctoTreasury)
        ) revert InvalidCTOTreasury();

        uint256 checkpointed = creatorFeesAccrued[token];
        if (checkpointed != 0) {
            creatorFeesAccrued[token] = 0;
            checkpointedCreatorFees[token][previousRecipient] += checkpointed;
            emit CreatorFeeCheckpointed(token, previousRecipient, checkpointed);
        }
        address cancelledPayout = pendingCreatorPayoutOf[token];
        if (cancelledPayout != address(0)) {
            delete pendingCreatorPayoutOf[token];
            emit PendingCreatorPayoutInvalidated(token, cancelledPayout);
        }
        _checkpointedCTOTreasuryOf[token] = ctoTreasury;
    }

    function switchCreatorPayoutForCTO(address token, address ctoTreasury) external override {
        if (msg.sender != ctoRegistry) revert UnauthorizedCTORegistry();
        if (ctoActive[token]) revert CTOAlreadyActive();
        if (_checkpointedCTOTreasuryOf[token] != ctoTreasury) revert CTOCheckpointMissing();
        address previousRecipient = creatorPayoutOf[token];
        if (previousRecipient == address(0)) revert InvalidCTOTreasury();

        creatorPayoutOf[token] = ctoTreasury;
        ctoTreasuryOf[token] = ctoTreasury;
        emit CTOFeeRouteActivated(token, previousRecipient, ctoTreasury);
    }

    function activateCTO(address token, address ctoTreasury) external override {
        if (msg.sender != ctoRegistry) revert UnauthorizedCTORegistry();
        if (ctoActive[token]) revert CTOAlreadyActive();
        if (_checkpointedCTOTreasuryOf[token] != ctoTreasury) revert CTOCheckpointMissing();
        if (creatorPayoutOf[token] != ctoTreasury || ctoTreasuryOf[token] != ctoTreasury) {
            revert CTORouteNotSwitched();
        }

        delete _checkpointedCTOTreasuryOf[token];
        ctoActive[token] = true;
    }

    function claimCheckpointedCreatorFees(address token, address recipient)
        external
        override
        nonReentrant
        returns (uint256 amount)
    {
        amount = checkpointedCreatorFees[token][recipient];
        if (amount == 0) revert NothingToClaim();
        checkpointedCreatorFees[token][recipient] = 0;
        totalCreatorFeesAccrued -= amount;
        _sendNative(recipient, amount);
        emit CheckpointedCreatorFeesClaimed(token, recipient, msg.sender, amount);
    }

    function fundCommunityVault(address token) external override nonReentrant returns (uint256 amount) {
        address vault = communityVault;
        if (vault == address(0)) revert EcosystemVaultsNotSet();
        amount = communityFeesAccruedByToken[token];
        if (amount == 0) revert NothingToFund();
        communityFeesAccruedByToken[token] = 0;
        communityFeesAccrued -= amount;
        ITokenCommunityVaultV4(vault).depositNative{value: amount}(token);
        emit CommunityVaultFunded(token, vault, amount, msg.sender);
    }

    function fundTraderRewardsVault(address token) external override nonReentrant returns (uint256 amount) {
        address vault = traderRewardsVault;
        if (vault == address(0)) revert EcosystemVaultsNotSet();
        amount = traderRewardsFeesAccruedByToken[token];
        if (amount == 0) revert NothingToFund();
        traderRewardsFeesAccruedByToken[token] = 0;
        traderRewardsFeesAccrued -= amount;
        ITraderRewardsVaultV4(vault).depositNative{value: amount}(token);
        emit TraderRewardsVaultFunded(token, vault, amount, msg.sender);
    }

    function totalLiabilities() external view override returns (uint256) {
        return protocolFeesAccrued + totalCreatorFeesAccrued + communityFeesAccrued + traderRewardsFeesAccrued;
    }

    receive() external payable {
        revert UnexpectedEther();
    }

    function _transferOwnership(address newOwner) internal override {
        address cancelledTreasury = pendingTreasury;
        if (cancelledTreasury != address(0)) {
            delete pendingTreasury;
            delete pendingTreasuryAcceptAfter;
            emit TreasuryProposalInvalidated(cancelledTreasury, newOwner);
        }
        super._transferOwnership(newOwner);
    }

    function _sendNative(address recipient, uint256 amount) private {
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }
}
