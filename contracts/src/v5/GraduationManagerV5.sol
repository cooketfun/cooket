// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {CanonicalPoolV5} from "./libraries/CanonicalPoolV5.sol";
import {ICooketLaunchHookV5} from "./interfaces/ICooketLaunchHookV5.sol";
import {IGraduationManagerV5} from "./interfaces/IGraduationManagerV5.sol";
import {GraduationManagerV5Boundary} from "./GraduationManagerV5Boundary.sol";

/// @notice Concrete, non-upgradeable V5 lifecycle manager.
/// @dev Registration and PoolManager initialization are live. Settlement accounting,
/// permanent custody verification, and activation fail closed until the production
/// V5 settlement and permanent custodian contracts exist.
contract GraduationManagerV5 is GraduationManagerV5Boundary, IGraduationManagerV5 {
    using CanonicalPoolV5 for PoolKey;

    error UnauthorizedLifecycleAuthority();
    error InvalidLifecycleAuthority();
    error InvalidCanonicalUsdc();
    error PoolInstructionAlreadyExists();
    error PoolInstructionMissing();
    error InvalidPoolLifecycle();
    error InitialLiquidityExecutionMismatch();
    error SettlementExecutionDeferred();
    error CustodyVerificationDeferred();
    error PoolActivationDeferred();

    event ManagerPoolRegistered(PoolId indexed poolId, address indexed launchToken, address indexed permanentCustodian);
    event ManagerPoolInitialized(PoolId indexed poolId);
    event ManagerSettlementArmed(PoolId indexed poolId, bytes32 operationHash);

    struct PoolInstruction {
        address permanentCustodian;
        uint160 initialSqrtPriceX96;
        ModifyLiquidityParams initialLiquidityParams;
        bytes hookData;
        bool registered;
        bool settlementArmed;
    }

    address public immutable override lifecycleAuthority;
    address public immutable override canonicalUsdc;
    mapping(PoolId poolId => PoolInstruction instruction) private _instructions;

    modifier onlyLifecycleAuthority() {
        if (msg.sender != lifecycleAuthority) revert UnauthorizedLifecycleAuthority();
        _;
    }

    constructor(
        address poolManager_,
        address hookBootstrapAuthority_,
        bytes32 expectedLaunchHookRuntimeCodeHash_,
        address lifecycleAuthority_,
        address canonicalUsdc_
    ) GraduationManagerV5Boundary(poolManager_, hookBootstrapAuthority_, expectedLaunchHookRuntimeCodeHash_) {
        if (lifecycleAuthority_ == address(0) || lifecycleAuthority_.code.length == 0) {
            revert InvalidLifecycleAuthority();
        }
        if (canonicalUsdc_ == address(0) || canonicalUsdc_.code.length == 0) revert InvalidCanonicalUsdc();
        lifecycleAuthority = lifecycleAuthority_;
        canonicalUsdc = canonicalUsdc_;
    }

    function registerPool(
        PoolKey calldata key,
        address launchToken,
        uint160 initialSqrtPriceX96,
        address permanentCustodian
    ) external override onlyLifecycleAuthority {
        _requireLaunchHookBound();
        CanonicalPoolV5.validate(key, launchToken, canonicalUsdc, launchHook);
        PoolId poolId = key.toId();
        PoolInstruction storage instruction = _instructions[poolId];
        if (instruction.registered) revert PoolInstructionAlreadyExists();
        ICooketLaunchHookV5(launchHook)
            .registerPool(key, launchToken, canonicalUsdc, initialSqrtPriceX96, permanentCustodian);
        instruction.permanentCustodian = permanentCustodian;
        instruction.initialSqrtPriceX96 = initialSqrtPriceX96;
        instruction.registered = true;
        emit ManagerPoolRegistered(poolId, launchToken, permanentCustodian);
    }

    function initializePool(PoolKey calldata key) external override onlyLifecycleAuthority {
        PoolId poolId = key.toId();
        PoolInstruction storage instruction = _requireInstruction(poolId);
        if (_hookLifecycle(poolId) != ICooketLaunchHookV5.Lifecycle.Registered) revert InvalidPoolLifecycle();
        IPoolManager(poolManager).initialize(key, instruction.initialSqrtPriceX96);
        if (_hookLifecycle(poolId) != ICooketLaunchHookV5.Lifecycle.Locked) revert InitialLiquidityExecutionMismatch();
        emit ManagerPoolInitialized(poolId);
    }

    /// @notice Records an unproven settlement instruction for a Locked pool.
    /// @dev Caller-supplied ticks, liquidityDelta, salt, and hookData are not canonical
    /// Cooket graduation economics. This function does not arm the hook. A later
    /// production settlement contract must derive the exact position from approved
    /// policy and available token/USDC balances rather than executing these values.
    function armSettlement(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        external
        override
        onlyLifecycleAuthority
    {
        PoolId poolId = key.toId();
        PoolInstruction storage instruction = _requireInstruction(poolId);
        if (_hookLifecycle(poolId) != ICooketLaunchHookV5.Lifecycle.Locked || params.liquidityDelta <= 0) {
            revert InvalidPoolLifecycle();
        }
        instruction.initialLiquidityParams = params;
        instruction.hookData = hookData;
        instruction.settlementArmed = true;
        emit ManagerSettlementArmed(poolId, keccak256(hookData));
    }

    /// @notice Deferred until production settlement proves canonical graduation economics.
    function executeInitialLiquidity(PoolKey calldata key) external override {
        _requireInstruction(key.toId());
        revert SettlementExecutionDeferred();
    }

    /// @notice Deferred until production custody proves the permanent position.
    function registerCustody(PoolKey calldata key) external override onlyLifecycleAuthority {
        _requireInstruction(key.toId());
        revert CustodyVerificationDeferred();
    }

    /// @notice Deferred until settlement and custody invariants are proven atomically.
    function activatePool(PoolKey calldata key) external override onlyLifecycleAuthority {
        _requireInstruction(key.toId());
        revert PoolActivationDeferred();
    }

    function _requireInstruction(PoolId poolId) private view returns (PoolInstruction storage instruction) {
        instruction = _instructions[poolId];
        if (!instruction.registered) revert PoolInstructionMissing();
    }

    function _hookLifecycle(PoolId poolId) private view returns (ICooketLaunchHookV5.Lifecycle) {
        return ICooketLaunchHookV5(launchHook).lifecycle(poolId);
    }
}
