// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGraduationSettlementExecutorV3 {
    struct SettlementResult {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Used;
        uint256 amount1Used;
        uint256 tokenResidual;
        uint256 usdcResidual6;
        uint256 nativeUsdcDust18;
    }

    function graduationManager() external view returns (address);
    function nonfungiblePositionManager() external view returns (address);
    function canonicalUsdc() external view returns (address);
    function execute(
        address token,
        address custodian,
        uint256 tokenAmount,
        uint256 nativeUsdcAmount,
        address residualEscrow
    ) external payable returns (SettlementResult memory result);
}
