// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {ICooketLaunchHookV5} from "./interfaces/ICooketLaunchHookV5.sol";
import {CanonicalPoolV5} from "./libraries/CanonicalPoolV5.sol";
import {EndpointConstantsV5} from "./libraries/EndpointConstantsV5.sol";

/// @notice Restrictive, shared, non-upgradeable endpoint-cp-v5 Uniswap V4 launch hook.
/// @dev This contract never transfers tokens and never calls PoolManager from a callback.
contract CooketLaunchHookV5 is ICooketLaunchHookV5 {
    using CanonicalPoolV5 for PoolKey;

    string public constant PROTOCOL_VERSION = "endpoint-cp-v5";
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v5");
    string public constant HOOK_POLICY = "cooket-v4-restrictive-launch-v1";
    bytes32 public constant HOOK_POLICY_HASH = keccak256("cooket-v4-restrictive-launch-v1");
    uint160 public constant HOOK_PERMISSION_MASK = 0x3EA0;

    error OnlyPoolManager();
    error OnlyGraduationManager();
    error CallbackDisabled();
    error PoolAlreadyRegistered();
    error PoolNotRegistered();
    error InvalidLifecycle(Lifecycle expected, Lifecycle actual);
    error InvalidInitialization();
    error InvalidCustodian();
    error InvalidLiquidityOperation();
    error PoolNotActive();
    error PermanentLiquidityRemovalForbidden();

    event PoolLifecycleAdvanced(PoolId indexed poolId, Lifecycle previousLifecycle, Lifecycle newLifecycle);
    event PoolRegisteredV5(
        PoolId indexed poolId,
        address indexed launchToken,
        address indexed canonicalUsdc,
        address permanentCustodian,
        uint160 initialSqrtPriceX96
    );

    struct PoolState {
        Lifecycle lifecycle;
        uint160 initialSqrtPriceX96;
        address permanentCustodian;
        bytes32 armedLiquidityOperationHash;
        int24 permanentTickLower;
        int24 permanentTickUpper;
        bytes32 permanentPositionSalt;
    }

    address public immutable override poolManager;
    address public immutable override graduationManager;
    mapping(PoolId poolId => PoolState state) private _poolStates;

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert OnlyPoolManager();
        _;
    }

    modifier onlyGraduationManager() {
        if (msg.sender != graduationManager) revert OnlyGraduationManager();
        _;
    }

    constructor(address poolManager_, address graduationManager_) {
        if (poolManager_ == address(0) || graduationManager_ == address(0)) revert InvalidInitialization();
        poolManager = poolManager_;
        graduationManager = graduationManager_;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function hookPolicyHash() external pure override returns (bytes32) {
        return HOOK_POLICY_HASH;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions = Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: true,
            beforeAddLiquidity: true,
            afterAddLiquidity: true,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: true,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function lifecycle(PoolId poolId) external view override returns (Lifecycle) {
        return _poolStates[poolId].lifecycle;
    }

    function registerPool(
        PoolKey calldata key,
        address launchToken,
        address canonicalUsdc,
        uint160 initialSqrtPriceX96,
        address permanentCustodian
    ) external override onlyGraduationManager returns (PoolId poolId) {
        if (initialSqrtPriceX96 == 0) revert InvalidInitialization();
        if (permanentCustodian == address(0) || permanentCustodian.code.length == 0) revert InvalidCustodian();
        CanonicalPoolV5.validate(key, launchToken, canonicalUsdc, address(this));
        poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        if (state.lifecycle != Lifecycle.Unregistered) revert PoolAlreadyRegistered();
        state.initialSqrtPriceX96 = initialSqrtPriceX96;
        state.permanentCustodian = permanentCustodian;
        _advance(poolId, state, Lifecycle.Unregistered, Lifecycle.Registered);
        emit PoolRegisteredV5(poolId, launchToken, canonicalUsdc, permanentCustodian, initialSqrtPriceX96);
    }

    function armSettlement(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes32 hookDataHash)
        external
        override
        onlyGraduationManager
    {
        if (params.liquidityDelta <= 0) revert InvalidLiquidityOperation();
        PoolId poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        _requireLifecycle(state, Lifecycle.Locked);
        state.armedLiquidityOperationHash = _liquidityOperationHash(params, hookDataHash);
        state.permanentTickLower = params.tickLower;
        state.permanentTickUpper = params.tickUpper;
        state.permanentPositionSalt = params.salt;
        _advance(poolId, state, Lifecycle.Locked, Lifecycle.SettlementArmed);
    }

    function registerCustody(PoolKey calldata key) external override onlyGraduationManager {
        PoolId poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        _advance(poolId, state, Lifecycle.InitialLiquidityAdded, Lifecycle.CustodyRegistered);
    }

    function activatePool(PoolKey calldata key) external override onlyGraduationManager {
        PoolId poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        _advance(poolId, state, Lifecycle.CustodyRegistered, Lifecycle.Active);
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        external
        override
        onlyPoolManager
        returns (bytes4)
    {
        PoolId poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        _requireLifecycle(state, Lifecycle.Registered);
        if (sender != graduationManager || sqrtPriceX96 != state.initialSqrtPriceX96) revert InvalidInitialization();
        _advance(poolId, state, Lifecycle.Registered, Lifecycle.Initializing);
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24)
        external
        override
        onlyPoolManager
        returns (bytes4)
    {
        PoolId poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        _requireLifecycle(state, Lifecycle.Initializing);
        if (sender != graduationManager || sqrtPriceX96 != state.initialSqrtPriceX96) revert InvalidInitialization();
        _advance(poolId, state, Lifecycle.Initializing, Lifecycle.Locked);
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4) {
        if (params.liquidityDelta <= 0) revert InvalidLiquidityOperation();
        PoolId poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        if (state.lifecycle == Lifecycle.Active) return IHooks.beforeAddLiquidity.selector;
        _requireLifecycle(state, Lifecycle.SettlementArmed);
        if (
            sender != state.permanentCustodian
                || _liquidityOperationHash(params, keccak256(hookData)) != state.armedLiquidityOperationHash
        ) revert InvalidLiquidityOperation();
        _advance(poolId, state, Lifecycle.SettlementArmed, Lifecycle.AddingInitialLiquidity);
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta,
        BalanceDelta,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4, BalanceDelta) {
        PoolId poolId = key.toId();
        PoolState storage state = _poolStates[poolId];
        if (state.lifecycle == Lifecycle.Active) {
            return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
        }
        _requireLifecycle(state, Lifecycle.AddingInitialLiquidity);
        if (
            sender != state.permanentCustodian
                || _liquidityOperationHash(params, keccak256(hookData)) != state.armedLiquidityOperationHash
        ) revert InvalidLiquidityOperation();
        _advance(poolId, state, Lifecycle.AddingInitialLiquidity, Lifecycle.InitialLiquidityAdded);
        return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external view override onlyPoolManager returns (bytes4) {
        PoolState storage state = _poolStates[key.toId()];
        if (state.lifecycle != Lifecycle.Active) revert PoolNotActive();
        if (params.liquidityDelta > 0) revert InvalidLiquidityOperation();
        if (sender == state.permanentCustodian) {
            if (params.liquidityDelta < 0) revert PermanentLiquidityRemovalForbidden();
            if (
                params.tickLower != state.permanentTickLower || params.tickUpper != state.permanentTickUpper
                    || params.salt != state.permanentPositionSalt || hookData.length != 0
            ) revert InvalidLiquidityOperation();
        }
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (_poolStates[key.toId()].lifecycle != Lifecycle.Active) revert PoolNotActive();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function beforeDonate(address, PoolKey calldata key, uint256, uint256, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        if (_poolStates[key.toId()].lifecycle != Lifecycle.Active) revert PoolNotActive();
        return IHooks.beforeDonate.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert CallbackDisabled();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        revert CallbackDisabled();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert CallbackDisabled();
    }

    function _requireLifecycle(PoolState storage state, Lifecycle expected) private view {
        if (state.lifecycle == Lifecycle.Unregistered && expected != Lifecycle.Unregistered) {
            revert PoolNotRegistered();
        }
        if (state.lifecycle != expected) revert InvalidLifecycle(expected, state.lifecycle);
    }

    function _advance(PoolId poolId, PoolState storage state, Lifecycle expected, Lifecycle next) private {
        _requireLifecycle(state, expected);
        state.lifecycle = next;
        emit PoolLifecycleAdvanced(poolId, expected, next);
    }

    function _liquidityOperationHash(ModifyLiquidityParams calldata params, bytes32 hookDataHash)
        private
        pure
        returns (bytes32)
    {
        return
            keccak256(abi.encode(params.tickLower, params.tickUpper, params.liquidityDelta, params.salt, hookDataHash));
    }
}
