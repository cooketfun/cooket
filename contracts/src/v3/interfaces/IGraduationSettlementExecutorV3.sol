// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGraduationSettlementExecutorV3 {
    function graduationManager() external view returns (address);
    function nonfungiblePositionManager() external view returns (address);
    function weth() external view returns (address);
    function execute(address token, address custodian, uint256 tokenAmount, uint256 ethAmount, address residualEscrow)
        external
        payable
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 used0,
            uint256 used1,
            uint256 tokenResidual,
            uint256 wethResidual
        );
}
