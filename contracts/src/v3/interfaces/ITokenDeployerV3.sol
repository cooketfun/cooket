// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITokenDeployerV3 {
    error NoAcceptableTokenAddress(bytes32 launchSeed);
    error TokenAddressCollision(address candidate);
    error UnauthorizedFactory();

    function deployToken(address creator, bytes32 userSalt, string calldata name, string calldata symbol)
        external
        returns (address token, bytes32 launchSeed, bytes32 candidateSalt, uint16 attemptIndex);

    function computeLaunchSeed(address creator, bytes32 userSalt, string calldata name, string calldata symbol)
        external
        view
        returns (bytes32);
    function computeCandidateSalt(bytes32 launchSeed, uint16 attemptIndex) external pure returns (bytes32);
    function computeTokenAddress(address creator, string calldata name, string calldata symbol, bytes32 candidateSalt)
        external
        view
        returns (address);
    function factory() external view returns (address);
    function graduationManager() external view returns (address);
    function protocolVersionHash() external pure returns (bytes32);
}
