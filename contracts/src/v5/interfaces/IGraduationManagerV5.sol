// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IGraduationManagerV5Boundary} from "./IGraduationManagerV5Boundary.sol";

interface IGraduationManagerV5 is IGraduationManagerV5Boundary {
    function lifecycleAuthority() external view returns (address);
    function canonicalUsdc() external view returns (address);
    function registerPool(
        PoolKey calldata key,
        address launchToken,
        uint160 initialSqrtPriceX96,
        address permanentCustodian
    ) external;
    function initializePool(PoolKey calldata key) external;
    /// @dev Records an unproven instruction only. Does not arm the hook or prove economics.
    function armSettlement(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        external;
    /// @dev Reverts SettlementExecutionDeferred until production settlement exists.
    function executeInitialLiquidity(PoolKey calldata key) external;
    /// @dev Reverts CustodyVerificationDeferred until production custody proof exists.
    function registerCustody(PoolKey calldata key) external;
    /// @dev Reverts PoolActivationDeferred until settlement and custody are proven atomically.
    function activatePool(PoolKey calldata key) external;
}
