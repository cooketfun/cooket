// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {CooketLaunchHookV5} from "../../src/v5/CooketLaunchHookV5.sol";
import {ICooketLaunchHookV5} from "../../src/v5/interfaces/ICooketLaunchHookV5.sol";
import {CanonicalPoolV5} from "../../src/v5/libraries/CanonicalPoolV5.sol";
import {Create2DeployerV5, MockCodeV5, MockHookManagerV5, MockPoolManagerV5} from "./mocks/MockV5Foundation.sol";

contract CooketLaunchHookV5Test is Test {
    using CanonicalPoolV5 for PoolKey;

    uint160 internal constant MASK = 0x3EA0;
    uint160 internal constant ALL_MASK = 0x3FFF;
    uint160 internal constant INITIAL_PRICE = 123456789;

    MockPoolManagerV5 internal poolManager;
    MockHookManagerV5 internal manager;
    Create2DeployerV5 internal create2Deployer;
    CooketLaunchHookV5 internal hook;
    MockCodeV5 internal token;
    MockCodeV5 internal usdc;
    MockCodeV5 internal custodian;
    PoolKey internal canonicalKey;
    ModifyLiquidityParams internal initialLiquidity;
    bytes internal initialHookData;

    function setUp() public {
        poolManager = new MockPoolManagerV5();
        manager = new MockHookManagerV5();
        create2Deployer = new Create2DeployerV5();
        hook = _deployHook(address(manager), 0);
        token = new MockCodeV5();
        usdc = new MockCodeV5();
        custodian = new MockCodeV5();
        canonicalKey = CanonicalPoolV5.key(address(token), address(usdc), address(hook));
        initialLiquidity = ModifyLiquidityParams({
            tickLower: -200, tickUpper: 200, liquidityDelta: 1_000_000, salt: keccak256("permanent-position")
        });
        initialHookData = abi.encode(keccak256("initial-liquidity"));
        manager.register(hook, canonicalKey, address(token), address(usdc), INITIAL_PRICE, address(custodian));
    }

    function testExactAddressMaskAndPermissionDeclaration() public view {
        assertEq(uint160(address(hook)) & ALL_MASK, MASK);
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.afterInitialize);
        assertTrue(permissions.beforeAddLiquidity);
        assertTrue(permissions.afterAddLiquidity);
        assertTrue(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertTrue(permissions.beforeSwap);
        assertFalse(permissions.afterSwap);
        assertTrue(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.afterSwapReturnDelta);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);
    }

    function testDirectCallbackSpoofingFailsClosed() public {
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        vm.expectRevert(CooketLaunchHookV5.OnlyPoolManager.selector);
        hook.beforeSwap(address(this), canonicalKey, params, "");
        vm.expectRevert(CooketLaunchHookV5.OnlyPoolManager.selector);
        hook.beforeInitialize(address(manager), canonicalKey, INITIAL_PRICE);
        vm.expectRevert(CooketLaunchHookV5.OnlyPoolManager.selector);
        hook.afterInitialize(address(manager), canonicalKey, INITIAL_PRICE, 0);
        vm.expectRevert(CooketLaunchHookV5.OnlyPoolManager.selector);
        hook.beforeAddLiquidity(address(custodian), canonicalKey, initialLiquidity, initialHookData);
        vm.expectRevert(CooketLaunchHookV5.OnlyPoolManager.selector);
        hook.afterAddLiquidity(
            address(custodian),
            canonicalKey,
            initialLiquidity,
            BalanceDelta.wrap(0),
            BalanceDelta.wrap(0),
            initialHookData
        );
        vm.expectRevert(CooketLaunchHookV5.OnlyPoolManager.selector);
        hook.beforeRemoveLiquidity(address(custodian), canonicalKey, initialLiquidity, "");
        vm.expectRevert(CooketLaunchHookV5.OnlyPoolManager.selector);
        hook.beforeDonate(address(this), canonicalKey, 1, 1, "");
    }

    function testDisabledCallbacksAuthenticateThenReject() public {
        vm.prank(address(poolManager));
        vm.expectRevert(CooketLaunchHookV5.CallbackDisabled.selector);
        hook.afterDonate(address(this), canonicalKey, 1, 1, "");

        vm.expectRevert(CooketLaunchHookV5.OnlyPoolManager.selector);
        hook.afterDonate(address(this), canonicalKey, 1, 1, "");
    }

    function testLifecycleAdvancesMonotonicallyToTerminalActive() public {
        _activate();
        assertEq(uint8(hook.lifecycle(canonicalKey.toId())), uint8(ICooketLaunchHookV5.Lifecycle.Active));
        vm.expectRevert(
            abi.encodeWithSelector(
                CooketLaunchHookV5.InvalidLifecycle.selector,
                ICooketLaunchHookV5.Lifecycle.CustodyRegistered,
                ICooketLaunchHookV5.Lifecycle.Active
            )
        );
        manager.activate(hook, canonicalKey);
    }

    function testInitializationRequiresManagerExactPriceAndRegisteredKey() public {
        vm.expectRevert(CooketLaunchHookV5.InvalidInitialization.selector);
        poolManager.initialize(hook, address(this), canonicalKey, INITIAL_PRICE);
        vm.expectRevert(CooketLaunchHookV5.InvalidInitialization.selector);
        poolManager.initialize(hook, address(manager), canonicalKey, INITIAL_PRICE + 1);

        PoolKey memory attackerKey = canonicalKey;
        attackerKey.hooks = IHooks(address(uint160(uint256(uint160(address(hook))) + (1 << 14))));
        vm.expectRevert(CooketLaunchHookV5.PoolNotRegistered.selector);
        poolManager.initialize(hook, address(manager), attackerKey, INITIAL_PRICE);
    }

    function testPreActivationSwapDonateAddRemoveAndZeroDeltaReject() public {
        _initialize();
        SwapParams memory swapParams = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        vm.expectRevert(CooketLaunchHookV5.PoolNotActive.selector);
        poolManager.swap(hook, address(this), canonicalKey, swapParams);
        vm.expectRevert(CooketLaunchHookV5.PoolNotActive.selector);
        poolManager.donate(hook, address(this), canonicalKey);

        vm.expectRevert();
        poolManager.addLiquidity(hook, address(this), canonicalKey, initialLiquidity, initialHookData);

        ModifyLiquidityParams memory negative = initialLiquidity;
        negative.liquidityDelta = -1;
        vm.expectRevert(CooketLaunchHookV5.PoolNotActive.selector);
        poolManager.removeLiquidity(hook, address(this), canonicalKey, negative, "");
        negative.liquidityDelta = 0;
        vm.expectRevert(CooketLaunchHookV5.PoolNotActive.selector);
        poolManager.removeLiquidity(hook, address(custodian), canonicalKey, negative, "");
    }

    function testArmedInitialLiquidityRequiresExactCustodianAndOperation() public {
        _initialize();
        manager.arm(hook, canonicalKey, initialLiquidity, keccak256(initialHookData));

        vm.expectRevert(CooketLaunchHookV5.InvalidLiquidityOperation.selector);
        poolManager.addLiquidity(hook, address(this), canonicalKey, initialLiquidity, initialHookData);

        ModifyLiquidityParams memory altered = initialLiquidity;
        altered.tickUpper += 200;
        vm.expectRevert(CooketLaunchHookV5.InvalidLiquidityOperation.selector);
        poolManager.addLiquidity(hook, address(custodian), canonicalKey, altered, initialHookData);

        poolManager.addLiquidity(hook, address(custodian), canonicalKey, initialLiquidity, initialHookData);
        assertEq(uint8(hook.lifecycle(canonicalKey.toId())), uint8(ICooketLaunchHookV5.Lifecycle.InitialLiquidityAdded));
    }

    function testPostActivationPermissionsAndPermanentCustodianRestrictions() public {
        _activate();
        SwapParams memory swapParams = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        assertEq(poolManager.swap(hook, address(0xBEEF), canonicalKey, swapParams), IHooks.beforeSwap.selector);
        assertEq(poolManager.donate(hook, address(0xCAFE), canonicalKey), IHooks.beforeDonate.selector);

        ModifyLiquidityParams memory otherAdd = initialLiquidity;
        otherAdd.salt = keccak256("other-lp");
        poolManager.addLiquidity(hook, address(0xBEEF), canonicalKey, otherAdd, "anything");
        ModifyLiquidityParams memory otherRemove = otherAdd;
        otherRemove.liquidityDelta = -1;
        assertEq(
            poolManager.removeLiquidity(hook, address(0xBEEF), canonicalKey, otherRemove, "anything"),
            IHooks.beforeRemoveLiquidity.selector
        );

        ModifyLiquidityParams memory collect = initialLiquidity;
        collect.liquidityDelta = 0;
        assertEq(
            poolManager.removeLiquidity(hook, address(custodian), canonicalKey, collect, ""),
            IHooks.beforeRemoveLiquidity.selector
        );
        collect.liquidityDelta = -1;
        vm.expectRevert(CooketLaunchHookV5.PermanentLiquidityRemovalForbidden.selector);
        poolManager.removeLiquidity(hook, address(custodian), canonicalKey, collect, "");
        collect.liquidityDelta = 0;
        vm.expectRevert(CooketLaunchHookV5.InvalidLiquidityOperation.selector);
        poolManager.removeLiquidity(hook, address(custodian), canonicalKey, collect, "nonempty");
    }

    function testPoolIdChangesWithHookAndCannotCollideWithZeroOrAttackerHook() public view {
        PoolId canonicalId = canonicalKey.toId();
        PoolKey memory zeroHook = canonicalKey;
        zeroHook.hooks = IHooks(address(0));
        PoolKey memory attackerHook = canonicalKey;
        attackerHook.hooks = IHooks(address(0xBEEF));
        assertTrue(PoolId.unwrap(canonicalId) != PoolId.unwrap(zeroHook.toId()));
        assertTrue(PoolId.unwrap(canonicalId) != PoolId.unwrap(attackerHook.toId()));
        assertTrue(PoolId.unwrap(zeroHook.toId()) != PoolId.unwrap(attackerHook.toId()));
    }

    function testCrossPoolStateIsolation() public {
        MockCodeV5 tokenTwo = new MockCodeV5();
        PoolKey memory keyTwo = CanonicalPoolV5.key(address(tokenTwo), address(usdc), address(hook));
        manager.register(hook, keyTwo, address(tokenTwo), address(usdc), INITIAL_PRICE + 1, address(custodian));
        _activate();
        assertEq(uint8(hook.lifecycle(canonicalKey.toId())), uint8(ICooketLaunchHookV5.Lifecycle.Active));
        assertEq(uint8(hook.lifecycle(keyTwo.toId())), uint8(ICooketLaunchHookV5.Lifecycle.Registered));
        vm.expectRevert(CooketLaunchHookV5.PoolNotActive.selector);
        poolManager.donate(hook, address(this), keyTwo);
    }

    function testDuplicateCallbackTransitionRejects() public {
        poolManager.beforeInitializeOnly(hook, address(manager), canonicalKey, INITIAL_PRICE);
        vm.expectRevert();
        poolManager.beforeInitializeOnly(hook, address(manager), canonicalKey, INITIAL_PRICE);
    }

    function testFuzzInitializationRejectsEveryWrongPrice(uint160 wrongPrice) public {
        vm.assume(wrongPrice != INITIAL_PRICE);
        vm.expectRevert(CooketLaunchHookV5.InvalidInitialization.selector);
        poolManager.initialize(hook, address(manager), canonicalKey, wrongPrice);
    }

    function _initialize() internal {
        poolManager.initialize(hook, address(manager), canonicalKey, INITIAL_PRICE);
    }

    function _activate() internal {
        _initialize();
        manager.arm(hook, canonicalKey, initialLiquidity, keccak256(initialHookData));
        poolManager.addLiquidity(hook, address(custodian), canonicalKey, initialLiquidity, initialHookData);
        manager.custody(hook, canonicalKey);
        manager.activate(hook, canonicalKey);
    }

    function _deployHook(address manager_, uint256 startingSalt) internal returns (CooketLaunchHookV5 deployed) {
        bytes memory creationCode =
            abi.encodePacked(type(CooketLaunchHookV5).creationCode, abi.encode(address(poolManager), manager_));
        bytes32 initCodeHash = keccak256(creationCode);
        for (uint256 candidate = startingSalt; candidate < startingSalt + 100_000; ++candidate) {
            bytes32 salt = bytes32(candidate);
            address predicted = create2Deployer.compute(salt, initCodeHash);
            if (uint160(predicted) & ALL_MASK == MASK) {
                deployed = CooketLaunchHookV5(create2Deployer.deploy(salt, creationCode));
                return deployed;
            }
        }
        revert("MASK_NOT_FOUND");
    }
}
