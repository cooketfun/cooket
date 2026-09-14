// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

/// @notice Permanent-custody execution boundary for an already armed V5 position.
/// @dev Placeholder until the production V5 permanent custodian exists. GraduationManagerV5
/// does not call this interface; executeInitialLiquidity fails closed in this checkpoint.
interface IInitialLiquidityExecutorV5 {
    function executeInitialLiquidity(
        address poolManager,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external;
}
