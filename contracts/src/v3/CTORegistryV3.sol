// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICTORegistryV3} from "./interfaces/ICTORegistryV3.sol";
import {ICTOTreasuryV3} from "./interfaces/ICTOTreasuryV3.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {ICooketFactoryV3} from "./interfaces/ICooketFactoryV3.sol";
import {ICooketCurveV3} from "./interfaces/ICooketCurveV3.sol";
import {ICooketTokenV3} from "./interfaces/ICooketTokenV3.sol";
import {IGraduationManagerV3} from "./interfaces/IGraduationManagerV3.sol";
import {IPermanentLPCustodianDeployerV3} from "./interfaces/IPermanentLPCustodianDeployerV3.sol";
import {IPermanentLPCustodianV3} from "./interfaces/IPermanentLPCustodianV3.sol";
import {CTOTreasuryV3} from "./CTOTreasuryV3.sol";

/// @notice Creator-voluntary, one-way CTO handover registry. It has no governance or arbitrary execution surface.
contract CTORegistryV3 is ICTORegistryV3, ReentrancyGuard {
    bytes32 public constant CTO_POLICY_HASH = keccak256("cooket-voluntary-cto-v1");
    bytes32 public constant CTO_DOMAIN = keccak256("COOKET_VOLUNTARY_CTO_V1");
    uint64 public constant ACCEPTANCE_WINDOW = 7 days;
    uint64 public constant EXECUTION_DELAY = 72 hours;
    uint64 public constant EXECUTION_GRACE_PERIOD = 7 days;
    uint256 public constant MAX_METADATA_URI_LENGTH = 256;

    address public immutable override feeManager;
    mapping(address token => uint64 nonce) public override tokenNonce;
    mapping(address token => bytes32 proposalId) public override currentProposalId;
    mapping(address token => address treasury) public override activeTreasury;
    mapping(address token => mapping(address treasury => bool canonical)) public override isCanonicalTreasury;
    mapping(bytes32 proposalId => Proposal details) private _proposals;

    constructor(address feeManager_) {
        if (feeManager_ == address(0) || feeManager_ != msg.sender) revert InvalidFeeManager();
        feeManager = feeManager_;
    }

    function ctoPolicyHash() external pure override returns (bytes32) {
        return CTO_POLICY_HASH;
    }

    function proposal(bytes32 proposalId) external view override returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function proposeCTO(address token, address controller, bytes32 metadataHash, string calldata metadataURI)
        external
        override
        nonReentrant
        returns (bytes32 proposalId, address treasury)
    {
        (address creator,, IGraduationManagerV3 manager,) = _canonicalRelationships(token);
        if (msg.sender != creator) revert UnauthorizedCreator();
        if (IFeeManagerV3(feeManager).ctoActive(token)) revert TokenAlreadyCTOActive();
        if (controller == address(0) || controller.code.length == 0) revert InvalidController();
        _requireNoLiveProposal(token);

        bytes32 resolvedMetadataHash = _resolveMetadata(metadataHash, metadataURI);
        uint64 nonce = tokenNonce[token] + 1;
        tokenNonce[token] = nonce;
        treasury = _deployTreasury(token, controller, nonce, manager.canonicalUsdc());

        Proposal memory details = Proposal({
            token: token,
            creator: creator,
            controller: controller,
            treasury: treasury,
            previousRecipient: IFeeManagerV3(feeManager).creatorPayoutOf(token),
            metadataHash: resolvedMetadataHash,
            nonce: nonce,
            createdAt: uint64(block.timestamp),
            acceptedAt: 0,
            state: ProposalState.Proposed
        });
        proposalId = _proposalId(details);
        _proposals[proposalId] = details;
        currentProposalId[token] = proposalId;
        _emitProposal(proposalId, details, metadataURI);
    }

    function acceptCTO(bytes32 proposalId) external override nonReentrant {
        Proposal storage details = _requireProposal(proposalId);
        if (details.state != ProposalState.Proposed) revert InvalidProposalState();
        if (block.timestamp > details.createdAt + ACCEPTANCE_WINDOW) revert AcceptanceWindowExpired();
        if (msg.sender != details.treasury || !isCanonicalTreasury[details.token][msg.sender]) {
            revert UnauthorizedTreasury();
        }
        _requireTreasury(details);
        uint64 acceptedAt = uint64(block.timestamp);
        details.acceptedAt = acceptedAt;
        details.state = ProposalState.Accepted;
        emit CTOAccepted(proposalId, details.token, details.treasury, details.controller, acceptedAt);
        emit CTOReady(
            proposalId,
            details.token,
            acceptedAt + EXECUTION_DELAY,
            acceptedAt + EXECUTION_DELAY + EXECUTION_GRACE_PERIOD
        );
    }

    function cancelCTO(bytes32 proposalId) external override {
        Proposal storage details = _requireProposal(proposalId);
        if (msg.sender != details.creator) revert UnauthorizedCreator();
        if (details.state != ProposalState.Proposed && details.state != ProposalState.Accepted) {
            revert InvalidProposalState();
        }
        details.state = ProposalState.Cancelled;
        emit CTOCancelled(proposalId, details.token, msg.sender);
    }

    function expireCTO(bytes32 proposalId) external override {
        Proposal storage details = _requireProposal(proposalId);
        ProposalState previousState = details.state;
        if (previousState == ProposalState.Proposed) {
            if (block.timestamp <= details.createdAt + ACCEPTANCE_WINDOW) revert InvalidProposalState();
        } else if (previousState == ProposalState.Accepted) {
            if (block.timestamp <= _executionDeadline(details)) revert InvalidProposalState();
        } else {
            revert InvalidProposalState();
        }
        details.state = ProposalState.Expired;
        emit CTOExpired(proposalId, details.token, previousState);
    }

    function executeCTO(bytes32 proposalId) external override nonReentrant {
        Proposal storage details = _requireProposal(proposalId);
        if (details.state != ProposalState.Accepted) revert InvalidProposalState();
        uint256 executeAfter = uint256(details.acceptedAt) + EXECUTION_DELAY;
        if (block.timestamp < executeAfter) revert TimelockNotElapsed();
        if (block.timestamp > executeAfter + EXECUTION_GRACE_PERIOD) revert ExecutionGraceExpired();

        (, address curve, IGraduationManagerV3 manager, bool graduated) = _canonicalRelationships(details.token);
        _requireTreasury(details);
        IFeeManagerV3 fees = IFeeManagerV3(feeManager);
        if (fees.creatorPayoutOf(details.token) != details.previousRecipient) revert StaleCreatorPayout();

        // Set terminal state before the external collection path. Any downstream failure reverts this write.
        details.state = ProposalState.Active;
        activeTreasury[details.token] = details.treasury;
        if (graduated) _collectCanonicalLPFees(details.token, curve, manager);
        fees.activateCTO(details.token, details.treasury);

        emit CTOActivated(
            proposalId, details.token, details.treasury, details.controller, details.previousRecipient, msg.sender
        );
    }

    function predictTreasury(address token, address controller, uint64 nonce) external view override returns (address) {
        (,, IGraduationManagerV3 manager,) = _canonicalRelationships(token);
        return _predictTreasury(token, controller, nonce, manager.canonicalUsdc());
    }

    function _canonicalRelationships(address token)
        private
        view
        returns (address creator, address curve, IGraduationManagerV3 manager, bool graduated)
    {
        IFeeManagerV3 fees = IFeeManagerV3(feeManager);
        address factory = fees.factory();
        if (token == address(0) || token.code.length == 0 || factory == address(0) || factory.code.length == 0) {
            revert InvalidCanonicalRelationship();
        }
        creator = fees.creatorOf(token);
        curve = fees.curveOf(token);
        _requireFactoryAndTokenRelationships(factory, token, creator, curve);
        manager = ICooketFactoryV3(factory).graduationManager();
        if (address(manager) == address(0) || address(manager).code.length == 0) {
            revert InvalidCanonicalRelationship();
        }
        if (
            address(ICooketCurveV3(curve).feeManager()) != feeManager
                || address(ICooketCurveV3(curve).graduationManager()) != address(manager)
        ) revert InvalidCanonicalRelationship();
        (address launchCurve, address launchCreator, bool registered, bool isGraduated) = manager.launchOf(token);
        if (manager.factory() != factory || !registered || launchCurve != curve || launchCreator != creator) {
            revert InvalidCanonicalRelationship();
        }
        graduated = isGraduated;
    }

    function _requireFactoryAndTokenRelationships(address factory, address token, address creator, address curve)
        private
        view
    {
        if (creator == address(0) || curve == address(0) || curve.code.length == 0) {
            revert InvalidCanonicalRelationship();
        }
        ICooketFactoryV3 canonicalFactory = ICooketFactoryV3(factory);
        (address factoryCreator, address factoryCurve) = canonicalFactory.tokenInfo(token);
        if (
            !canonicalFactory.isToken(token) || canonicalFactory.curveOf(token) != curve || factoryCreator != creator
                || factoryCurve != curve || ICooketTokenV3(token).factory() != factory
                || ICooketTokenV3(token).creator() != creator || !ICooketTokenV3(token).initialized()
                || ICooketCurveV3(curve).factory() != factory || ICooketCurveV3(curve).token() != token
                || ICooketCurveV3(curve).creator() != creator
        ) revert InvalidCanonicalRelationship();
    }

    function _collectCanonicalLPFees(address token, address curve, IGraduationManagerV3 manager) private {
        if (!manager.settled(token)) revert InvalidCanonicalRelationship();
        address deployer = manager.permanentLPCustodianDeployer();
        address vault = manager.permanentLPFeeVault();
        if (deployer == address(0) || deployer.code.length == 0 || vault == address(0) || vault.code.length == 0) {
            revert InvalidCanonicalRelationship();
        }
        IPermanentLPCustodianDeployerV3 canonicalDeployer = IPermanentLPCustodianDeployerV3(deployer);
        address custodianAddress = canonicalDeployer.custodianOf(token);
        if (custodianAddress == address(0) || custodianAddress.code.length == 0) {
            revert InvalidCanonicalRelationship();
        }
        IPermanentLPCustodianV3 custodian = IPermanentLPCustodianV3(custodianAddress);
        if (
            canonicalDeployer.graduationManager() != address(manager)
                || canonicalDeployer.factory() != manager.factory() || canonicalDeployer.feeVault() != vault
                || canonicalDeployer.canonicalUsdc() != manager.canonicalUsdc() || custodian.launchToken() != token
                || custodian.graduationManager() != address(manager) || custodian.feeVault() != vault
                || custodian.canonicalFactory() != manager.factory()
                || custodian.canonicalUsdc() != manager.canonicalUsdc() || !custodian.positionRegistered()
                || custodian.positionTokenId() == 0 || IFeeManagerV3(feeManager).curveOf(token) != curve
        ) revert InvalidCanonicalRelationship();
        custodian.collectFees();
    }

    function _requireTreasury(Proposal storage details) private view {
        if (!isCanonicalTreasury[details.token][details.treasury] || details.treasury.code.length == 0) {
            revert InvalidTreasury();
        }
        ICTOTreasuryV3 treasury = ICTOTreasuryV3(details.treasury);
        if (
            treasury.registry() != address(this) || treasury.launchToken() != details.token
                || treasury.controller() != details.controller || treasury.ctoPolicyHash() != CTO_POLICY_HASH
        ) revert InvalidTreasury();
    }

    function _requireNoLiveProposal(address token) private view {
        bytes32 current = currentProposalId[token];
        if (current == bytes32(0)) return;
        ProposalState state = _proposals[current].state;
        if (state == ProposalState.Proposed || state == ProposalState.Accepted || state == ProposalState.Active) {
            revert LiveProposalExists();
        }
    }

    function _requireProposal(bytes32 proposalId) private view returns (Proposal storage details) {
        details = _proposals[proposalId];
        if (details.state == ProposalState.None) revert ProposalNotFound();
    }

    function _resolveMetadata(bytes32 metadataHash, string calldata metadataURI) private pure returns (bytes32) {
        bytes memory uri = bytes(metadataURI);
        if (uri.length > MAX_METADATA_URI_LENGTH) revert InvalidMetadata();
        if (uri.length == 0) return metadataHash;
        bytes32 calculated = keccak256(uri);
        if (metadataHash != bytes32(0) && metadataHash != calculated) revert InvalidMetadata();
        return calculated;
    }

    function _proposalId(Proposal memory details) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                CTO_DOMAIN,
                block.chainid,
                address(this),
                details.token,
                details.nonce,
                details.treasury,
                details.controller,
                details.metadataHash
            )
        );
    }

    function _emitProposal(bytes32 proposalId, Proposal memory details, string calldata metadataURI) private {
        emit CTOProposed(
            proposalId,
            details.token,
            details.creator,
            details.controller,
            details.treasury,
            details.previousRecipient,
            details.nonce,
            details.createdAt + ACCEPTANCE_WINDOW,
            details.metadataHash,
            metadataURI
        );
    }

    function _executionDeadline(Proposal storage details) private view returns (uint256) {
        return uint256(details.acceptedAt) + EXECUTION_DELAY + EXECUTION_GRACE_PERIOD;
    }

    function _treasurySalt(address token, address controller, uint64 nonce) private view returns (bytes32) {
        return keccak256(abi.encode(CTO_DOMAIN, block.chainid, address(this), token, controller, nonce));
    }

    function _deployTreasury(address token, address controller, uint64 nonce, address canonicalUsdc)
        private
        returns (address treasury)
    {
        bytes32 salt = _treasurySalt(token, controller, nonce);
        address predicted = _predictTreasury(token, controller, nonce, canonicalUsdc);
        if (controller == predicted) revert ControllerIsTreasury();
        treasury = address(new CTOTreasuryV3{salt: salt}(address(this), token, controller, canonicalUsdc));
        if (treasury != predicted) revert InvalidTreasury();
        isCanonicalTreasury[token][treasury] = true;
        emit CTOTreasuryDeployed(token, controller, treasury, nonce, salt);
    }

    function _predictTreasury(address token, address controller, uint64 nonce, address canonicalUsdc)
        private
        view
        returns (address)
    {
        bytes32 salt = _treasurySalt(token, controller, nonce);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(CTOTreasuryV3).creationCode, abi.encode(address(this), token, controller, canonicalUsdc)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
