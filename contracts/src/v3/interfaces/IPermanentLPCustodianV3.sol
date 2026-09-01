// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPermanentLPCustodianV3 {
    error AlreadyRegistered();
    error InvalidDependency();
    error InvalidPosition();
    error InvalidTokenId();
    error PositionNotRegistered();
    error UnauthorizedGraduationManager();

    event PermanentPositionRegistered(
        address indexed launchToken,
        uint256 indexed tokenId,
        address indexed positionManager,
        int24 tickLower,
        int24 tickUpper
    );
    event PermanentFeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);

    function bindPosition(uint256 tokenId) external;
    function collectFees() external returns (uint256 amount0, uint256 amount1);
    function protocolVersionHash() external pure returns (bytes32);
    function launchToken() external view returns (address);
    function weth() external view returns (address);
    function graduationManager() external view returns (address);
    function feeVault() external view returns (address);
    function nonfungiblePositionManager() external view returns (address);
    function canonicalFactory() external view returns (address);
    function positionTokenId() external view returns (uint256);
    /// @notice Canonical name for the irreversibly bound LP NFT identifier.
    function boundTokenId() external view returns (uint256);
    function positionRegistered() external view returns (bool);
}
