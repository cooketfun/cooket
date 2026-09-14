// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {ICooketLaunchHookV5} from "../../../src/v5/interfaces/ICooketLaunchHookV5.sol";
import {IGraduationManagerV5Boundary} from "../../../src/v5/interfaces/IGraduationManagerV5Boundary.sol";
import {IInitialLiquidityExecutorV5} from "../../../src/v5/interfaces/IInitialLiquidityExecutorV5.sol";
import {GraduationManagerV5Boundary} from "../../../src/v5/GraduationManagerV5Boundary.sol";
import {GraduationManagerV5} from "../../../src/v5/GraduationManagerV5.sol";

contract MockCodeV5 {}

contract Create2DeployerV5 {
    error DeploymentFailed();

    function deploy(bytes32 salt, bytes memory creationCode) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        if (deployed == address(0)) revert DeploymentFailed();
    }

    function compute(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}

contract BoundaryDeployerV5 {
    function deploy(address poolManager, address authority, bytes32 expectedCodeHash)
        external
        returns (GraduationManagerV5Boundary)
    {
        return new GraduationManagerV5Boundary(poolManager, authority, expectedCodeHash);
    }
}

contract GraduationManagerDeployerV5 {
    function deploy(
        address poolManager,
        address authority,
        bytes32 expectedCodeHash,
        address lifecycleAuthority,
        address canonicalUsdc
    ) external returns (GraduationManagerV5) {
        return new GraduationManagerV5(poolManager, authority, expectedCodeHash, lifecycleAuthority, canonicalUsdc);
    }
}

contract MockPoolManagerV5 {
    function initialize(PoolKey calldata key, uint160 sqrtPriceX96) external returns (int24) {
        key.hooks.beforeInitialize(msg.sender, key, sqrtPriceX96);
        key.hooks.afterInitialize(msg.sender, key, sqrtPriceX96, 0);
        return 0;
    }

    function initialize(IHooks hook, address sender, PoolKey calldata key, uint160 sqrtPriceX96) external {
        hook.beforeInitialize(sender, key, sqrtPriceX96);
        hook.afterInitialize(sender, key, sqrtPriceX96, 0);
    }

    function beforeInitializeOnly(IHooks hook, address sender, PoolKey calldata key, uint160 sqrtPriceX96) external {
        hook.beforeInitialize(sender, key, sqrtPriceX96);
    }

    function addLiquidity(
        IHooks hook,
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external {
        hook.beforeAddLiquidity(sender, key, params, hookData);
        hook.afterAddLiquidity(
            sender, key, params, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, hookData
        );
    }

    function addLiquidityFromCustodian(
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external {
        key.hooks.beforeAddLiquidity(msg.sender, key, params, hookData);
        key.hooks
            .afterAddLiquidity(
                msg.sender, key, params, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, hookData
            );
    }

    function removeLiquidity(
        IHooks hook,
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4) {
        return hook.beforeRemoveLiquidity(sender, key, params, hookData);
    }

    function swap(IHooks hook, address sender, PoolKey calldata key, SwapParams calldata params)
        external
        returns (bytes4)
    {
        (bytes4 selector,,) = hook.beforeSwap(sender, key, params, "");
        return selector;
    }

    function donate(IHooks hook, address sender, PoolKey calldata key) external returns (bytes4) {
        return hook.beforeDonate(sender, key, 1, 1, "");
    }
}

contract MockLifecycleAuthorityV5 {}

contract MockInitialLiquidityCustodianV5 is IInitialLiquidityExecutorV5 {
    bool public executed;

    function executeInitialLiquidity(
        address poolManager,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external {
        executed = true;
        MockPoolManagerV5(poolManager).addLiquidityFromCustodian(key, params, hookData);
    }
}

contract MockHookManagerV5 {
    function register(
        ICooketLaunchHookV5 hook,
        PoolKey calldata key,
        address token,
        address usdc,
        uint160 price,
        address custodian
    ) external {
        hook.registerPool(key, token, usdc, price, custodian);
    }

    function arm(
        ICooketLaunchHookV5 hook,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes32 hookDataHash
    ) external {
        hook.armSettlement(key, params, hookDataHash);
    }

    function custody(ICooketLaunchHookV5 hook, PoolKey calldata key) external {
        hook.registerCustody(key);
    }

    function activate(ICooketLaunchHookV5 hook, PoolKey calldata key) external {
        hook.activatePool(key);
    }
}

contract MockFactoryLaunchGateV5 {
    IGraduationManagerV5Boundary public immutable manager;
    bool public factoryBound;
    uint256 public launches;

    constructor(IGraduationManagerV5Boundary manager_) {
        manager = manager_;
    }

    function bindFactory() external {
        manager.requireLaunchHookBound();
        factoryBound = true;
    }

    function registerLaunch() external {
        manager.requireLaunchHookBound();
        if (!factoryBound) revert();
        ++launches;
    }
}

contract MockBindingHookV5 {
    address public immutable poolManager;
    address public immutable graduationManager;
    bytes32 public immutable version;
    bytes32 public immutable policy;
    uint160 public immutable bitmap;

    constructor(address poolManager_, address manager_, bytes32 version_, bytes32 policy_, uint160 bitmap_) {
        poolManager = poolManager_;
        graduationManager = manager_;
        version = version_;
        policy = policy_;
        bitmap = bitmap_;
    }

    function protocolVersionHash() external view returns (bytes32) {
        return version;
    }

    function hookPolicyHash() external view returns (bytes32) {
        return policy;
    }

    function getHookPermissions() external view returns (Hooks.Permissions memory permissions) {
        uint160 value = bitmap;
        permissions = Hooks.Permissions({
            beforeInitialize: value & (1 << 13) != 0,
            afterInitialize: value & (1 << 12) != 0,
            beforeAddLiquidity: value & (1 << 11) != 0,
            afterAddLiquidity: value & (1 << 10) != 0,
            beforeRemoveLiquidity: value & (1 << 9) != 0,
            afterRemoveLiquidity: value & (1 << 8) != 0,
            beforeSwap: value & (1 << 7) != 0,
            afterSwap: value & (1 << 6) != 0,
            beforeDonate: value & (1 << 5) != 0,
            afterDonate: value & (1 << 4) != 0,
            beforeSwapReturnDelta: value & (1 << 3) != 0,
            afterSwapReturnDelta: value & (1 << 2) != 0,
            afterAddLiquidityReturnDelta: value & (1 << 1) != 0,
            afterRemoveLiquidityReturnDelta: value & 1 != 0
        });
    }
}

contract RevertingBindingHookV5 {
    fallback() external {
        revert();
    }
}

contract MalformedBindingHookV5 {
    fallback() external {
        assembly ("memory-safe") {
            mstore(0, 1)
            return(31, 1)
        }
    }
}

contract DelegateProxyV5 {
    address public immutable implementation;

    constructor(address implementation_) {
        implementation = implementation_;
    }

    fallback() external {
        address target = implementation;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}
