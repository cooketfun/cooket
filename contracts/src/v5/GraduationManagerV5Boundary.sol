// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {ICooketLaunchHookV5} from "./interfaces/ICooketLaunchHookV5.sol";
import {IGraduationManagerV5Boundary} from "./interfaces/IGraduationManagerV5Boundary.sol";
import {EndpointConstantsV5} from "./libraries/EndpointConstantsV5.sol";

/// @notice One-time trust boundary that binds the canonical restrictive V5 hook.
/// @dev The immutable authority remains visible as provenance after its sole capability is consumed.
contract GraduationManagerV5Boundary is IGraduationManagerV5Boundary {
    string public constant PROTOCOL_VERSION = "endpoint-cp-v5";
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v5");
    string public constant HOOK_POLICY = "cooket-v4-restrictive-launch-v1";
    bytes32 public constant HOOK_POLICY_HASH = keccak256("cooket-v4-restrictive-launch-v1");
    uint160 public constant HOOK_PERMISSION_MASK = 0x3EA0;
    uint160 private constant ALL_HOOK_MASK = 0x3FFF;

    address public immutable override poolManager;
    address public immutable override hookBootstrapAuthority;
    bytes32 public immutable override expectedLaunchHookRuntimeCodeHash;
    address public override launchHook;
    bool public override hookBootstrapConsumed;

    constructor(address poolManager_, address hookBootstrapAuthority_, bytes32 expectedLaunchHookRuntimeCodeHash_) {
        if (poolManager_ == address(0) || poolManager_.code.length == 0) revert InvalidLaunchHook();
        if (hookBootstrapAuthority_ == address(0)) revert InvalidBootstrapAuthority();
        if (expectedLaunchHookRuntimeCodeHash_ == bytes32(0)) revert InvalidExpectedHookCodeHash();
        poolManager = poolManager_;
        hookBootstrapAuthority = hookBootstrapAuthority_;
        expectedLaunchHookRuntimeCodeHash = expectedLaunchHookRuntimeCodeHash_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function hookPolicyHash() external pure override returns (bytes32) {
        return HOOK_POLICY_HASH;
    }

    function bindLaunchHook(address hook) external override {
        if (hookBootstrapConsumed) revert HookBootstrapConsumed();
        if (launchHook != address(0)) revert HookAlreadyBound();
        if (msg.sender != hookBootstrapAuthority) revert UnauthorizedHookBootstrap();
        _validateLaunchHook(hook);

        launchHook = hook;
        hookBootstrapConsumed = true;
        emit LaunchHookBound(hook);
        emit HookBootstrapAuthorityConsumed(hookBootstrapAuthority);
    }

    function isLaunchHookBound() public view override returns (bool) {
        address hook = launchHook;
        return hookBootstrapConsumed && hook != address(0) && hook.codehash == expectedLaunchHookRuntimeCodeHash;
    }

    function requireLaunchHookBound() external view override {
        _requireLaunchHookBound();
    }

    function _requireLaunchHookBound() internal view {
        if (!isLaunchHookBound()) revert HookNotBound();
    }

    function _validateLaunchHook(address hook) private view {
        if (hook == address(0) || hook.code.length == 0) revert InvalidLaunchHook();
        if (hook.codehash != expectedLaunchHookRuntimeCodeHash) revert LaunchHookCodeHashMismatch();
        ICooketLaunchHookV5 candidate = ICooketLaunchHookV5(hook);
        if (candidate.poolManager() != poolManager || candidate.graduationManager() != address(this)) {
            revert LaunchHookRelationshipMismatch();
        }
        if (candidate.protocolVersionHash() != PROTOCOL_VERSION_HASH) revert LaunchHookVersionMismatch();
        if (candidate.hookPolicyHash() != HOOK_POLICY_HASH) revert LaunchHookPolicyMismatch();
        if (
            uint160(hook) & ALL_HOOK_MASK != EndpointConstantsV5.HOOK_PERMISSION_MASK
                || _permissionBitmap(candidate.getHookPermissions()) != EndpointConstantsV5.HOOK_PERMISSION_MASK
        ) revert LaunchHookPermissionMismatch();
    }

    function _permissionBitmap(Hooks.Permissions memory permissions) private pure returns (uint160 bitmap) {
        if (permissions.beforeInitialize) bitmap |= 1 << 13;
        if (permissions.afterInitialize) bitmap |= 1 << 12;
        if (permissions.beforeAddLiquidity) bitmap |= 1 << 11;
        if (permissions.afterAddLiquidity) bitmap |= 1 << 10;
        if (permissions.beforeRemoveLiquidity) bitmap |= 1 << 9;
        if (permissions.afterRemoveLiquidity) bitmap |= 1 << 8;
        if (permissions.beforeSwap) bitmap |= 1 << 7;
        if (permissions.afterSwap) bitmap |= 1 << 6;
        if (permissions.beforeDonate) bitmap |= 1 << 5;
        if (permissions.afterDonate) bitmap |= 1 << 4;
        if (permissions.beforeSwapReturnDelta) bitmap |= 1 << 3;
        if (permissions.afterSwapReturnDelta) bitmap |= 1 << 2;
        if (permissions.afterAddLiquidityReturnDelta) bitmap |= 1 << 1;
        if (permissions.afterRemoveLiquidityReturnDelta) bitmap |= 1;
    }
}
