// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal canonical Uniswap V3 factory surface used at launch.
interface IUniswapV3FactoryMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function feeAmountTickSpacing(uint24 fee) external view returns (int24 tickSpacing);
}
