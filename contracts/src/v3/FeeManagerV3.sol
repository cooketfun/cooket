// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {ICooketCurveV3} from "./interfaces/ICooketCurveV3.sol";
import {ICooketFactoryV3} from "./interfaces/ICooketFactoryV3.sol";
import {ICooketTokenV3} from "./interfaces/ICooketTokenV3.sol";
import {ITokenCommunityVaultV3} from "./interfaces/ITokenCommunityVaultV3.sol";
import {ITraderRewardsVaultV3} from "./interfaces/ITraderRewardsVaultV3.sol";
import {EndpointConstantsV3} from "./libraries/EndpointConstantsV3.sol";

/// @notice Pull-based custody of endpoint curve ETH fees and recipient lifecycle only.
contract FeeManagerV3 is IFeeManagerV3, Ownable2Step, ReentrancyGuard {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");
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

    constructor(address governance, address initialTreasury) Ownable(governance) {
        if (initialTreasury == address(0)) revert InvalidTreasury();
        factoryBootstrapAuthority = governance;
        ecosystemBootstrapAuthority = governance;
        treasury = initialTreasury;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function feePolicyHash() external pure override returns (bytes32) {
        return EndpointConstantsV3.FEE_POLICY_HASH;
    }

    function setFactoryOnce(address factory_) external override {
        if (factory != address(0)) revert FactoryAlreadySet();
        if (msg.sender != factoryBootstrapAuthority || factoryBootstrapAuthority == address(0)) {
            revert UnauthorizedBootstrap();
        }
        if (factory_ == address(0) || factory_.code.length == 0) revert InvalidFactory();
        if (ICooketFactoryV3(factory_).protocolVersionHash() != PROTOCOL_VERSION_HASH) revert FactoryVersionMismatch();
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
                || ITokenCommunityVaultV3(communityVault_).feeManager() != address(this)
                || ITraderRewardsVaultV3(traderRewardsVault_).feeManager() != address(this)
                || ITokenCommunityVaultV3(communityVault_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ITraderRewardsVaultV3(traderRewardsVault_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ITokenCommunityVaultV3(communityVault_).feePolicyHash() != EndpointConstantsV3.FEE_POLICY_HASH
                || ITraderRewardsVaultV3(traderRewardsVault_).feePolicyHash() != EndpointConstantsV3.FEE_POLICY_HASH
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
        (address registeredCreator, address registeredCurve) = ICooketFactoryV3(factory).tokenInfo(token);
        if (
            !ICooketFactoryV3(factory).isToken(token) || ICooketFactoryV3(factory).curveOf(token) != curve
                || registeredCurve != curve || registeredCreator != creator
                || ICooketCurveV3(curve).factory() != factory || ICooketCurveV3(curve).token() != token
                || ICooketCurveV3(curve).creator() != creator || ICooketTokenV3(token).factory() != factory
                || ICooketTokenV3(token).creator() != creator || !ICooketTokenV3(token).initialized()
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
        if (msg.sender != creatorOf[token]) revert UnauthorizedCreator();
        if (proposedPayout == address(0)) revert InvalidPayoutRecipient();
        if (proposedPayout == creatorPayoutOf[token]) revert CreatorPayoutUnchanged();
        pendingCreatorPayoutOf[token] = proposedPayout;
        emit CreatorPayoutProposed(token, creatorPayoutOf[token], proposedPayout);
    }

    function acceptCreatorPayout(address token) external override {
        address proposedPayout = pendingCreatorPayoutOf[token];
        if (msg.sender != proposedPayout || proposedPayout == address(0)) revert UnauthorizedPendingPayout();
        address previousPayout = creatorPayoutOf[token];
        creatorPayoutOf[token] = proposedPayout;
        delete pendingCreatorPayoutOf[token];
        emit CreatorPayoutAccepted(token, previousPayout, proposedPayout);
    }

    function cancelCreatorPayout(address token) external override {
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

    function fundCommunityVault(address token) external override nonReentrant returns (uint256 amount) {
        address vault = communityVault;
        if (vault == address(0)) revert EcosystemVaultsNotSet();
        amount = communityFeesAccruedByToken[token];
        if (amount == 0) revert NothingToFund();
        communityFeesAccruedByToken[token] = 0;
        communityFeesAccrued -= amount;
        ITokenCommunityVaultV3(vault).depositNative{value: amount}(token);
        emit CommunityVaultFunded(token, vault, amount, msg.sender);
    }

    function fundTraderRewardsVault(address token) external override nonReentrant returns (uint256 amount) {
        address vault = traderRewardsVault;
        if (vault == address(0)) revert EcosystemVaultsNotSet();
        amount = traderRewardsFeesAccruedByToken[token];
        if (amount == 0) revert NothingToFund();
        traderRewardsFeesAccruedByToken[token] = 0;
        traderRewardsFeesAccrued -= amount;
        ITraderRewardsVaultV3(vault).depositNative{value: amount}(token);
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
