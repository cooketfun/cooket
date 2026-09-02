// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICTORegistryV3 {
    enum ProposalState {
        None,
        Proposed,
        Accepted,
        Cancelled,
        Expired,
        Active
    }

    struct Proposal {
        address token;
        address creator;
        address controller;
        address treasury;
        address previousRecipient;
        bytes32 metadataHash;
        uint64 nonce;
        uint64 createdAt;
        uint64 acceptedAt;
        ProposalState state;
    }

    error AcceptanceWindowExpired();
    error ControllerIsTreasury();
    error ExecutionGraceExpired();
    error InvalidCanonicalRelationship();
    error InvalidController();
    error InvalidFeeManager();
    error InvalidMetadata();
    error InvalidProposalState();
    error InvalidTreasury();
    error LiveProposalExists();
    error ProposalNotFound();
    error StaleCreatorPayout();
    error TimelockNotElapsed();
    error TokenAlreadyCTOActive();
    error UnauthorizedCreator();
    error UnauthorizedTreasury();

    event CTOTreasuryDeployed(
        address indexed token, address indexed controller, address indexed treasury, uint64 nonce, bytes32 salt
    );
    event CTOProposed(
        bytes32 indexed proposalId,
        address indexed token,
        address indexed creator,
        address controller,
        address treasury,
        address previousRecipient,
        uint64 nonce,
        uint64 acceptanceDeadline,
        bytes32 metadataHash,
        string metadataURI
    );
    event CTOAccepted(
        bytes32 indexed proposalId,
        address indexed token,
        address indexed treasury,
        address controller,
        uint64 acceptedAt
    );
    event CTOReady(bytes32 indexed proposalId, address indexed token, uint64 executeAfter, uint64 executeDeadline);
    event CTOCancelled(bytes32 indexed proposalId, address indexed token, address indexed creator);
    event CTOExpired(bytes32 indexed proposalId, address indexed token, ProposalState previousState);
    event CTOActivated(
        bytes32 indexed proposalId,
        address indexed token,
        address indexed treasury,
        address controller,
        address previousRecipient,
        address executor
    );

    function proposeCTO(address token, address controller, bytes32 metadataHash, string calldata metadataURI)
        external
        returns (bytes32 proposalId, address treasury);
    function acceptCTO(bytes32 proposalId) external;
    function cancelCTO(bytes32 proposalId) external;
    function expireCTO(bytes32 proposalId) external;
    function executeCTO(bytes32 proposalId) external;

    function ctoPolicyHash() external pure returns (bytes32);
    function feeManager() external view returns (address);
    function tokenNonce(address token) external view returns (uint64);
    function currentProposalId(address token) external view returns (bytes32);
    function activeTreasury(address token) external view returns (address);
    function isCanonicalTreasury(address token, address treasury) external view returns (bool);
    function proposal(bytes32 proposalId) external view returns (Proposal memory);
    function predictTreasury(address token, address controller, uint64 nonce) external view returns (address);
}
