// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Permanent, non-withdrawable accounting for integer-rounded LP dust.
interface IPermanentResidualEscrowV3 {
    error InvalidDependency();
    error UnauthorizedDeposit();
    error UnsupportedAsset();
    error ZeroAmount();
    error InsufficientBacking();
    error InvalidNativeUsdcDust();

    event ResidualDeposited(address indexed launchToken, address indexed asset, uint256 amount);
    event NativeUsdcDustDeposited(address indexed launchToken, uint256 nativeUsdcDust18);

    function protocolVersionHash() external pure returns (bytes32);
    function launchToken() external view returns (address);
    function graduationManager() external view returns (address);
    function canonicalUsdc() external view returns (address);
    function settlementExecutor() external view returns (address);
    function depositedResidual(address asset) external view returns (uint256);
    function depositedNativeUsdcDust18() external view returns (uint256);
    function deposit(address asset, uint256 amount) external;
    function depositNativeUsdcDust() external payable;
}
