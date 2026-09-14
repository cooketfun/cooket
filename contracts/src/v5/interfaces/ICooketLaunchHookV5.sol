// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

interface ICooketLaunchHookV5 is IHooks {
    enum Lifecycle {
        Unregistered,
        Registered,
        Initializing,
        Locked,
        SettlementArmed,
        AddingInitialLiquidity,
        InitialLiquidityAdded,
        CustodyRegistered,
        Active
    }

    function poolManager() external view returns (address);
    function graduationManager() external view returns (address);
    function protocolVersionHash() external pure returns (bytes32);
    function hookPolicyHash() external pure returns (bytes32);
    function getHookPermissions() external pure returns (Hooks.Permissions memory);
    function lifecycle(PoolId poolId) external view returns (Lifecycle);

    function registerPool(
        PoolKey calldata key,
        address launchToken,
        address canonicalUsdc,
        uint160 initialSqrtPriceX96,
        address permanentCustodian
    ) external returns (PoolId poolId);
    function armSettlement(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes32 hookDataHash) external;
    function registerCustody(PoolKey calldata key) external;
    function activatePool(PoolKey calldata key) external;
}
