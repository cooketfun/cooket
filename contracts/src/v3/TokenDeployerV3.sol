// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGraduationManagerV3} from "./interfaces/IGraduationManagerV3.sol";
import {ITokenDeployerV3} from "./interfaces/ITokenDeployerV3.sol";
import {CooketTokenV3} from "./CooketTokenV3.sol";

/// @notice Immutable CREATE2 address selector for endpoint-cp-v3 launch tokens.
/// @dev Public salts provide bounded recovery, not secrecy. Clients should use
/// cryptographically random 32-byte salts and replace a salt after public failure.
contract TokenDeployerV3 is ITokenDeployerV3 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");
    bytes32 public constant ARC_PROTOCOL_DOMAIN = keccak256("COOKET_ARC_V1");
    uint16 public constant MAX_CANDIDATES = 256;

    address public immutable override factory;
    address public immutable override graduationManager;

    struct Selection {
        address candidate;
        bytes32 salt;
        uint16 attemptIndex;
    }

    constructor(address graduationManager_) {
        if (graduationManager_ == address(0) || graduationManager_.code.length == 0) revert UnauthorizedFactory();
        factory = msg.sender;
        graduationManager = graduationManager_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function deployToken(address creator, bytes32 userSalt, string calldata name, string calldata symbol)
        external
        override
        returns (address token, bytes32 launchSeed, bytes32 selectedSalt, uint16 attemptIndex)
    {
        if (msg.sender != factory) revert UnauthorizedFactory();
        launchSeed = _launchSeed(creator, userSalt, name, symbol);
        bytes32 initCodeHash = _tokenInitCodeHash(creator, name, symbol);
        Selection memory selected = _selectCandidate(launchSeed, initCodeHash);
        token = address(new CooketTokenV3{salt: selected.salt}(factory, creator, name, symbol));
        if (token != selected.candidate) revert TokenAddressCollision(selected.candidate);
        return (token, launchSeed, selected.salt, selected.attemptIndex);
    }

    function computeLaunchSeed(address creator, bytes32 userSalt, string calldata name, string calldata symbol)
        external
        view
        override
        returns (bytes32)
    {
        return _launchSeed(creator, userSalt, name, symbol);
    }

    function computeCandidateSalt(bytes32 launchSeed, uint16 attemptIndex) public pure override returns (bytes32) {
        return keccak256(abi.encode(launchSeed, attemptIndex));
    }

    function computeTokenAddress(address creator, string calldata name, string calldata symbol, bytes32 candidateSalt)
        external
        view
        override
        returns (address)
    {
        return _tokenAddress(creator, name, symbol, candidateSalt);
    }

    function _launchSeed(address creator, bytes32 userSalt, string calldata name, string calldata symbol)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                ARC_PROTOCOL_DOMAIN,
                block.chainid,
                factory,
                creator,
                userSalt,
                keccak256(bytes(name)),
                keccak256(bytes(symbol))
            )
        );
    }

    function _tokenAddress(address creator, string calldata name, string calldata symbol, bytes32 candidateSalt)
        private
        view
        returns (address)
    {
        return _create2Address(_tokenInitCodeHash(creator, name, symbol), candidateSalt);
    }

    function _tokenInitCodeHash(address creator, string calldata name, string calldata symbol)
        private
        view
        returns (bytes32 initCodeHash)
    {
        initCodeHash = keccak256(
            abi.encodePacked(type(CooketTokenV3).creationCode, abi.encode(factory, creator, name, symbol))
        );
    }

    function _selectCandidate(bytes32 launchSeed, bytes32 initCodeHash)
        private
        view
        returns (Selection memory selected)
    {
        for (uint16 i; i < MAX_CANDIDATES; ++i) {
            bytes32 candidateSalt = computeCandidateSalt(launchSeed, i);
            address candidate = _create2Address(initCodeHash, candidateSalt);
            if (candidate.code.length != 0) continue;

            (IGraduationManagerV3.PoolCandidateState state,) =
                IGraduationManagerV3(graduationManager).classifyPoolCandidate(candidate);
            if (
                state != IGraduationManagerV3.PoolCandidateState.NoPool
                    && state != IGraduationManagerV3.PoolCandidateState.Uninitialized
            ) continue;
            return Selection({candidate: candidate, salt: candidateSalt, attemptIndex: i});
        }
        revert NoAcceptableTokenAddress(launchSeed);
    }

    function _create2Address(bytes32 initCodeHash, bytes32 candidateSalt) private view returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), candidateSalt, initCodeHash))))
        );
    }
}
