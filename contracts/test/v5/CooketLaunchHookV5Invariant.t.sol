// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {CooketLaunchHookV5} from "../../src/v5/CooketLaunchHookV5.sol";
import {ICooketLaunchHookV5} from "../../src/v5/interfaces/ICooketLaunchHookV5.sol";
import {CanonicalPoolV5} from "../../src/v5/libraries/CanonicalPoolV5.sol";
import {Create2DeployerV5, MockCodeV5, MockHookManagerV5, MockPoolManagerV5} from "./mocks/MockV5Foundation.sol";

contract HookLifecycleHandlerV5 is Test {
    CooketLaunchHookV5 internal immutable hook;
    MockHookManagerV5 internal immutable manager;
    MockPoolManagerV5 internal immutable poolManager;
    PoolKey internal key;
    ModifyLiquidityParams internal initialLiquidity;
    address internal immutable token;
    address internal immutable usdc;
    address internal immutable custodian;

    constructor(
        CooketLaunchHookV5 hook_,
        MockHookManagerV5 manager_,
        MockPoolManagerV5 poolManager_,
        PoolKey memory key_,
        ModifyLiquidityParams memory initialLiquidity_,
        address token_,
        address usdc_,
        address custodian_
    ) {
        hook = hook_;
        manager = manager_;
        poolManager = poolManager_;
        key = key_;
        initialLiquidity = initialLiquidity_;
        token = token_;
        usdc = usdc_;
        custodian = custodian_;
    }

    function attemptLifecycleMutation(uint8 action, int256 liquidityDelta, bytes32 salt) external {
        action %= 8;
        if (action == 0) {
            try manager.register(hook, key, token, usdc, 123456789, custodian) {} catch {}
        } else if (action == 1) {
            try manager.arm(hook, key, initialLiquidity, keccak256("initial")) {} catch {}
        } else if (action == 2) {
            try manager.custody(hook, key) {} catch {}
        } else if (action == 3) {
            try manager.activate(hook, key) {} catch {}
        } else if (action == 4) {
            SwapParams memory swapParams = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
            try poolManager.swap(hook, address(this), key, swapParams) {} catch {}
        } else if (action == 5) {
            try poolManager.donate(hook, address(this), key) {} catch {}
        } else {
            ModifyLiquidityParams memory params = ModifyLiquidityParams({
                tickLower: initialLiquidity.tickLower,
                tickUpper: initialLiquidity.tickUpper,
                liquidityDelta: liquidityDelta,
                salt: salt
            });
            if (liquidityDelta > 0) {
                try poolManager.addLiquidity(hook, address(this), key, params, "") {} catch {}
            } else {
                try poolManager.removeLiquidity(hook, address(this), key, params, "") {} catch {}
            }
        }
    }
}

contract CooketLaunchHookV5InvariantTest is StdInvariant, Test {
    using CanonicalPoolV5 for PoolKey;

    uint160 internal constant MASK = 0x3EA0;
    uint160 internal constant ALL_MASK = 0x3FFF;

    CooketLaunchHookV5 internal hook;
    PoolKey internal key;
    HookLifecycleHandlerV5 internal handler;

    function setUp() public {
        MockPoolManagerV5 poolManager = new MockPoolManagerV5();
        MockHookManagerV5 manager = new MockHookManagerV5();
        Create2DeployerV5 deployer = new Create2DeployerV5();
        hook = _deployHook(deployer, poolManager, address(manager));
        MockCodeV5 token = new MockCodeV5();
        MockCodeV5 usdc = new MockCodeV5();
        MockCodeV5 custodian = new MockCodeV5();
        key = CanonicalPoolV5.key(address(token), address(usdc), address(hook));
        ModifyLiquidityParams memory initialLiquidity = ModifyLiquidityParams({
            tickLower: -200, tickUpper: 200, liquidityDelta: 1_000_000, salt: keccak256("permanent-position")
        });
        bytes memory hookData = abi.encode(keccak256("initial-liquidity"));

        manager.register(hook, key, address(token), address(usdc), 123456789, address(custodian));
        poolManager.initialize(hook, address(manager), key, 123456789);
        manager.arm(hook, key, initialLiquidity, keccak256(hookData));
        poolManager.addLiquidity(hook, address(custodian), key, initialLiquidity, hookData);
        manager.custody(hook, key);
        manager.activate(hook, key);

        handler = new HookLifecycleHandlerV5(
            hook, manager, poolManager, key, initialLiquidity, address(token), address(usdc), address(custodian)
        );
        targetContract(address(handler));
    }

    function invariantActiveIsTerminal() public view {
        assertEq(uint8(hook.lifecycle(key.toId())), uint8(ICooketLaunchHookV5.Lifecycle.Active));
    }

    function invariantHookIdentityAndMaskNeverChange() public view {
        assertEq(uint160(address(hook)) & ALL_MASK, MASK);
        assertTrue(hook.poolManager() != address(0));
        assertTrue(hook.graduationManager() != address(0));
    }

    function _deployHook(Create2DeployerV5 deployer, MockPoolManagerV5 poolManager, address manager)
        internal
        returns (CooketLaunchHookV5 deployed)
    {
        bytes memory creationCode =
            abi.encodePacked(type(CooketLaunchHookV5).creationCode, abi.encode(address(poolManager), manager));
        bytes32 initCodeHash = keccak256(creationCode);
        for (uint256 candidate; candidate < 100_000; ++candidate) {
            bytes32 salt = bytes32(candidate);
            address predicted = deployer.compute(salt, initCodeHash);
            if (uint160(predicted) & ALL_MASK == MASK) {
                return CooketLaunchHookV5(deployer.deploy(salt, creationCode));
            }
        }
        revert("MASK_NOT_FOUND");
    }
}
