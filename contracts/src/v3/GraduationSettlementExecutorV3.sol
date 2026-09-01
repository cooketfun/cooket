// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IGraduationSettlementExecutorV3} from "./interfaces/IGraduationSettlementExecutorV3.sol";
import {INonfungiblePositionManagerV3} from "./interfaces/INonfungiblePositionManagerV3.sol";
import {IWETHV3} from "./interfaces/IWETHV3.sol";

/// @notice Immutable, manager-authorized executor for one canonical settlement.
contract GraduationSettlementExecutorV3 is IGraduationSettlementExecutorV3 {
    using SafeERC20 for IERC20;
    uint256 private constant TOKEN_USED_TOKEN1 = 199_999_999_999_999_999_999_999_968;
    uint256 private constant TOKEN_USED_TOKEN0 = 199_999_999_999_999_999_999_999_977;
    uint256 private constant WETH_USED = 2_999_999_999_999_998_668;
    address public immutable override graduationManager;
    address public immutable override nonfungiblePositionManager;
    address public immutable override weth;
    error InvalidDependency();
    error UnauthorizedCaller();
    error SettlementMismatch();

    constructor(address manager_, address positionManager_, address weth_) {
        if (
            manager_ == address(0) || positionManager_ == address(0) || weth_ == address(0) || manager_.code.length == 0
                || positionManager_.code.length == 0 || weth_.code.length == 0
        ) revert InvalidDependency();
        graduationManager = manager_;
        nonfungiblePositionManager = positionManager_;
        weth = weth_;
    }

    function execute(address token, address custodian, uint256 tokenAmount, uint256 ethAmount, address residualEscrow)
        external
        payable
        override
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 used0,
            uint256 used1,
            uint256 tokenResidual,
            uint256 wethResidual
        )
    {
        if (msg.sender != graduationManager || msg.value != ethAmount || token == address(0) || custodian == address(0))
        {
            revert UnauthorizedCaller();
        }
        bool tokenIsToken0 = token < weth;
        (used0, used1, liquidity, tokenId) = _mintPosition(token, custodian, tokenAmount, ethAmount, tokenIsToken0);
        (tokenResidual, wethResidual) =
            _routeResiduals(token, tokenAmount, ethAmount, used0, used1, tokenIsToken0, residualEscrow);
    }

    function _routeResiduals(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        uint256 used0,
        uint256 used1,
        bool tokenIsToken0,
        address residualEscrow
    ) private returns (uint256 tokenResidual, uint256 wethResidual) {
        uint256 usedToken = tokenIsToken0 ? used0 : used1;
        uint256 usedWeth = tokenIsToken0 ? used1 : used0;
        if (usedToken > tokenAmount || usedWeth > ethAmount) revert SettlementMismatch();
        tokenResidual = tokenAmount - usedToken;
        wethResidual = ethAmount - usedWeth;
        if (tokenResidual != 0) IERC20(token).safeTransfer(residualEscrow, tokenResidual);
        if (wethResidual != 0) IERC20(weth).safeTransfer(residualEscrow, wethResidual);
        if (IERC20(token).balanceOf(address(this)) != 0 || IERC20(weth).balanceOf(address(this)) != 0) {
            revert SettlementMismatch();
        }
    }

    function _mintPosition(address token, address custodian, uint256 tokenAmount, uint256 ethAmount, bool tokenIsToken0)
        private
        returns (uint256 used0, uint256 used1, uint128 liquidity, uint256 tokenId)
    {
        INonfungiblePositionManagerV3.MintParams memory params;
        params.token0 = tokenIsToken0 ? token : weth;
        params.token1 = tokenIsToken0 ? weth : token;
        params.fee = 10_000;
        params.tickLower = -887_200;
        params.tickUpper = 887_200;
        params.amount0Desired = tokenIsToken0 ? tokenAmount : ethAmount;
        params.amount1Desired = tokenIsToken0 ? ethAmount : tokenAmount;
        params.amount0Min = tokenIsToken0 ? TOKEN_USED_TOKEN0 : WETH_USED;
        params.amount1Min = tokenIsToken0 ? WETH_USED : TOKEN_USED_TOKEN1;
        params.recipient = custodian;
        params.deadline = block.timestamp;
        IERC20(token).forceApprove(nonfungiblePositionManager, tokenAmount);
        IWETHV3(weth).deposit{value: ethAmount}();
        IERC20(weth).forceApprove(nonfungiblePositionManager, ethAmount);
        (tokenId, liquidity, used0, used1) = INonfungiblePositionManagerV3(nonfungiblePositionManager).mint(params);
        if (used0 != params.amount0Min || used1 != params.amount1Min || liquidity == 0) revert SettlementMismatch();
        IERC20(token).forceApprove(nonfungiblePositionManager, 0);
        IERC20(weth).forceApprove(nonfungiblePositionManager, 0);
    }
}
