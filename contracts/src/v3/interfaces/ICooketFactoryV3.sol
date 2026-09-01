// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGraduationManagerV3} from "./IGraduationManagerV3.sol";

interface ICooketFactoryV3 {
    struct TokenInfo {
        address creator;
        address curve;
    }

    error DuplicateToken();
    error InvalidFeeManager();
    error InvalidGraduationManager();
    error InventoryMismatch();
    error InvalidTokenName();
    error InvalidTokenSymbol();
    error DependencyFactoryMismatch();
    error DependencyVersionMismatch();
    error InvalidUserSalt();
    error InvalidTokenDeployer();
    error InvalidCurveDeployer();

    event TokenLaunchedV3(
        address indexed creator,
        address indexed token,
        address indexed curve,
        string protocolVersion,
        uint256 totalSupply,
        uint256 curveAllocation,
        uint256 lpAllocation,
        address initialCreatorPayout,
        address canonicalPool,
        bytes32 launchSeed,
        bytes32 candidateSalt,
        uint16 attemptIndex
    );

    function createToken(string calldata name, string calldata symbol, bytes32 userSalt)
        external
        returns (address token, address curve);
    function tokenInfo(address token) external view returns (address creator, address curve);
    function isToken(address token) external view returns (bool);
    function curveOf(address token) external view returns (address);
    function tokensByCreator(address creator) external view returns (address[] memory);
    function PROTOCOL_VERSION() external view returns (string memory);
    function protocolVersionHash() external pure returns (bytes32);
    function tokenDeployer() external view returns (address);
    function curveDeployer() external view returns (address);
    function graduationManager() external view returns (IGraduationManagerV3);
}
