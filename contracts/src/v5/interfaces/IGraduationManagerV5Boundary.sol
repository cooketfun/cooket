// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IGraduationManagerV5Boundary {
    error HookAlreadyBound();
    error HookBootstrapConsumed();
    error HookNotBound();
    error InvalidBootstrapAuthority();
    error UnauthorizedHookBootstrap();
    error InvalidExpectedHookCodeHash();
    error InvalidLaunchHook();
    error LaunchHookCodeHashMismatch();
    error LaunchHookRelationshipMismatch();
    error LaunchHookVersionMismatch();
    error LaunchHookPolicyMismatch();
    error LaunchHookPermissionMismatch();

    event LaunchHookBound(address indexed hook);
    event HookBootstrapAuthorityConsumed(address indexed authority);

    function bindLaunchHook(address hook) external;
    function requireLaunchHookBound() external view;
    function isLaunchHookBound() external view returns (bool);
    function poolManager() external view returns (address);
    function hookBootstrapAuthority() external view returns (address);
    function expectedLaunchHookRuntimeCodeHash() external view returns (bytes32);
    function launchHook() external view returns (address);
    function hookBootstrapConsumed() external view returns (bool);
    function protocolVersionHash() external pure returns (bytes32);
    function hookPolicyHash() external pure returns (bytes32);
}
