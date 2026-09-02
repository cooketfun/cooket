// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IGraduationSettlementExecutorV3} from "./interfaces/IGraduationSettlementExecutorV3.sol";
import {INonfungiblePositionManagerV3} from "./interfaces/INonfungiblePositionManagerV3.sol";
import {IPermanentResidualEscrowV3} from "./interfaces/IPermanentResidualEscrowV3.sol";
import {ArcNativeUsdcV3} from "./libraries/ArcNativeUsdcV3.sol";

/// @notice Immutable, manager-authorized executor for one canonical settlement.
contract GraduationSettlementExecutorV3 is IGraduationSettlementExecutorV3 {
    using SafeERC20 for IERC20;
    uint256 private constant MAX_TOKEN_ROUNDING_RESIDUAL = 1e18;
    uint256 private constant MAX_USDC6_ROUNDING_RESIDUAL = 1;
    address public immutable override graduationManager;
    address public immutable override nonfungiblePositionManager;
    address public constant override canonicalUsdc = ArcNativeUsdcV3.CANONICAL_USDC;
    error InvalidDependency();
    error UnauthorizedCaller();
    error SettlementMismatch();

    struct BalanceSnapshot {
        uint256 nativeAmount18;
        uint256 usdcAmount6;
        uint256 tokenAmount18;
    }

    constructor(address manager_, address positionManager_) {
        if (
            manager_ == address(0) || positionManager_ == address(0) || manager_.code.length == 0
                || positionManager_.code.length == 0 || canonicalUsdc.code.length == 0
        ) revert InvalidDependency();
        graduationManager = manager_;
        nonfungiblePositionManager = positionManager_;
    }

    function execute(
        address token,
        address custodian,
        uint256 tokenAmount,
        uint256 nativeUsdcAmount,
        address residualEscrow
    ) external payable override returns (SettlementResult memory result) {
        if (
            msg.sender != graduationManager || msg.value != nativeUsdcAmount || token == address(0)
                || token == canonicalUsdc || custodian == address(0) || residualEscrow == address(0)
                || residualEscrow.code.length == 0
        ) {
            revert UnauthorizedCaller();
        }
        uint256 usdcAmount6 = ArcNativeUsdcV3.nativeUsdcToUsdc6Exact(nativeUsdcAmount);
        bool tokenIsToken0 = token < canonicalUsdc;
        BalanceSnapshot memory beforeBalances = BalanceSnapshot({
            nativeAmount18: address(this).balance,
            usdcAmount6: IERC20(canonicalUsdc).balanceOf(address(this)),
            tokenAmount18: IERC20(token).balanceOf(address(this))
        });
        if (
            beforeBalances.nativeAmount18 < nativeUsdcAmount || beforeBalances.usdcAmount6 < usdcAmount6
                || beforeBalances.tokenAmount18 < tokenAmount
        ) revert SettlementMismatch();

        (result.amount0Used, result.amount1Used, result.liquidity, result.tokenId) =
            _mintPosition(token, custodian, tokenAmount, usdcAmount6, tokenIsToken0);
        uint256 usedToken = tokenIsToken0 ? result.amount0Used : result.amount1Used;
        uint256 usedUsdc6 = tokenIsToken0 ? result.amount1Used : result.amount0Used;
        if (
            usedToken > tokenAmount || usedUsdc6 > usdcAmount6 || result.liquidity == 0
                || usedToken < tokenAmount - MAX_TOKEN_ROUNDING_RESIDUAL
                || usedUsdc6 < usdcAmount6 - MAX_USDC6_ROUNDING_RESIDUAL
        ) revert SettlementMismatch();

        IERC20(token).forceApprove(nonfungiblePositionManager, 0);
        IERC20(canonicalUsdc).forceApprove(nonfungiblePositionManager, 0);
        uint256 nativeUsed18 = ArcNativeUsdcV3.usdc6ToNativeUsdc(usedUsdc6);
        if (
            beforeBalances.tokenAmount18 - IERC20(token).balanceOf(address(this)) != usedToken
                || beforeBalances.usdcAmount6 - IERC20(canonicalUsdc).balanceOf(address(this)) != usedUsdc6
                || beforeBalances.nativeAmount18 - address(this).balance != nativeUsed18
        ) revert SettlementMismatch();

        result.tokenResidual = tokenAmount - usedToken;
        result.usdcResidual6 = usdcAmount6 - usedUsdc6;
        if (result.tokenResidual != 0) IERC20(token).safeTransfer(residualEscrow, result.tokenResidual);
        if (result.usdcResidual6 != 0) IERC20(canonicalUsdc).safeTransfer(residualEscrow, result.usdcResidual6);
        result.nativeUsdcDust18 = nativeUsdcAmount - ArcNativeUsdcV3.usdc6ToNativeUsdc(usdcAmount6);
        if (result.nativeUsdcDust18 != 0) {
            IPermanentResidualEscrowV3(residualEscrow).depositNativeUsdcDust{value: result.nativeUsdcDust18}();
        }
        if (
            IERC20(token).balanceOf(address(this)) != beforeBalances.tokenAmount18 - tokenAmount
                || IERC20(canonicalUsdc).balanceOf(address(this)) != beforeBalances.usdcAmount6 - usdcAmount6
                || address(this).balance != beforeBalances.nativeAmount18 - nativeUsdcAmount
                || IERC20(token).allowance(address(this), nonfungiblePositionManager) != 0
                || IERC20(canonicalUsdc).allowance(address(this), nonfungiblePositionManager) != 0
        ) revert SettlementMismatch();
    }

    function _mintPosition(
        address token,
        address custodian,
        uint256 tokenAmount,
        uint256 usdcAmount6,
        bool tokenIsToken0
    ) private returns (uint256 used0, uint256 used1, uint128 liquidity, uint256 tokenId) {
        INonfungiblePositionManagerV3.MintParams memory params;
        params.token0 = tokenIsToken0 ? token : canonicalUsdc;
        params.token1 = tokenIsToken0 ? canonicalUsdc : token;
        params.fee = 10_000;
        params.tickLower = -887_200;
        params.tickUpper = 887_200;
        params.amount0Desired = tokenIsToken0 ? tokenAmount : usdcAmount6;
        params.amount1Desired = tokenIsToken0 ? usdcAmount6 : tokenAmount;
        params.amount0Min = tokenIsToken0 ? tokenAmount - MAX_TOKEN_ROUNDING_RESIDUAL : usdcAmount6 - 1;
        params.amount1Min = tokenIsToken0 ? usdcAmount6 - 1 : tokenAmount - MAX_TOKEN_ROUNDING_RESIDUAL;
        params.recipient = custodian;
        params.deadline = block.timestamp;
        IERC20(token).forceApprove(nonfungiblePositionManager, tokenAmount);
        IERC20(canonicalUsdc).forceApprove(nonfungiblePositionManager, usdcAmount6);
        (tokenId, liquidity, used0, used1) = INonfungiblePositionManagerV3(nonfungiblePositionManager).mint(params);
    }
}
