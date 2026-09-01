// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Permanent, non-withdrawable accounting for integer-rounded LP dust.
interface IPermanentResidualEscrowV3 {
    error InvalidDependency();
    error UnauthorizedDeposit();
    error UnsupportedAsset();
    error ZeroAmount();
    error InsufficientBacking();

    event ResidualDeposited(address indexed launchToken, address indexed asset, uint256 amount);

    function protocolVersionHash() external pure returns (bytes32);
    function launchToken() external view returns (address);
    function graduationManager() external view returns (address);
    function weth() external view returns (address);
    function depositedResidual(address asset) external view returns (uint256);
    function deposit(address asset, uint256 amount) external;
}
