// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {CooketLaunchHookV5} from "../../src/v5/CooketLaunchHookV5.sol";
import {GraduationManagerV5} from "../../src/v5/GraduationManagerV5.sol";
import {ICooketLaunchHookV5} from "../../src/v5/interfaces/ICooketLaunchHookV5.sol";
import {CanonicalPoolV5} from "../../src/v5/libraries/CanonicalPoolV5.sol";
import {EndpointConstantsV5} from "../../src/v5/libraries/EndpointConstantsV5.sol";
import {
    Create2DeployerV5,
    GraduationManagerDeployerV5,
    MockCodeV5,
    MockInitialLiquidityCustodianV5,
    MockLifecycleAuthorityV5,
    MockPoolManagerV5
} from "./mocks/MockV5Foundation.sol";

/// @notice Authority and fail-closed proofs for the production manager.
/// @dev Active is unreachable until production settlement and custody exist.
contract GraduationManagerV5LifecycleTest is Test {
    using CanonicalPoolV5 for PoolKey;

    uint160 internal constant MASK = 0x3EA0;
    uint160 internal constant ALL_MASK = 0x3FFF;
    uint160 internal constant INITIAL_PRICE = 123456789;

    MockPoolManagerV5 internal poolManager;
    MockLifecycleAuthorityV5 internal lifecycleAuthority;
    MockCodeV5 internal token;
    MockCodeV5 internal usdc;
    MockInitialLiquidityCustodianV5 internal custodian;
    Create2DeployerV5 internal create2Deployer;
    GraduationManagerDeployerV5 internal managerDeployer;
    GraduationManagerV5 internal manager;
    CooketLaunchHookV5 internal hook;
    PoolKey internal canonicalKey;
    ModifyLiquidityParams internal initialLiquidity;
    bytes internal initialHookData;

    function setUp() public {
        poolManager = new MockPoolManagerV5();
        lifecycleAuthority = new MockLifecycleAuthorityV5();
        token = new MockCodeV5();
        usdc = new MockCodeV5();
        custodian = new MockInitialLiquidityCustodianV5();
        create2Deployer = new Create2DeployerV5();
        managerDeployer = new GraduationManagerDeployerV5();

        address predictedManager =
            vm.computeCreateAddress(address(managerDeployer), vm.getNonce(address(managerDeployer)));
        CooketLaunchHookV5 probe = _deployHook(predictedManager, 0);
        manager = managerDeployer.deploy(
            address(poolManager), address(this), address(probe).codehash, address(lifecycleAuthority), address(usdc)
        );
        hook = _deployHook(address(manager), 100_000);
        manager.bindLaunchHook(address(hook));

        canonicalKey = CanonicalPoolV5.key(address(token), address(usdc), address(hook));
        initialLiquidity = ModifyLiquidityParams({
            tickLower: -200, tickUpper: 200, liquidityDelta: 1_000_000, salt: keccak256("permanent-position")
        });
        initialHookData =
            abi.encode(EndpointConstantsV5.LP_ALLOCATION, EndpointConstantsV5.GRADUATION_NATIVE_USDC_RESERVE);
    }

    function testProductionManagerOwnsRegisterAndInitializeAuthorityPath() public {
        assertEq(hook.graduationManager(), address(manager));
        assertEq(manager.lifecycleAuthority(), address(lifecycleAuthority));
        assertTrue(manager.isLaunchHookBound());

        vm.expectRevert(GraduationManagerV5.UnauthorizedLifecycleAuthority.selector);
        manager.registerPool(canonicalKey, address(token), INITIAL_PRICE, address(custodian));
        vm.expectRevert(CooketLaunchHookV5.OnlyGraduationManager.selector);
        hook.registerPool(canonicalKey, address(token), address(usdc), INITIAL_PRICE, address(custodian));

        vm.prank(address(lifecycleAuthority));
        manager.registerPool(canonicalKey, address(token), INITIAL_PRICE, address(custodian));
        PoolId poolId = canonicalKey.toId();
        assertEq(uint8(hook.lifecycle(poolId)), uint8(ICooketLaunchHookV5.Lifecycle.Registered));

        vm.expectRevert(GraduationManagerV5.UnauthorizedLifecycleAuthority.selector);
        manager.initializePool(canonicalKey);
        vm.prank(address(lifecycleAuthority));
        manager.initializePool(canonicalKey);
        assertEq(uint8(hook.lifecycle(poolId)), uint8(ICooketLaunchHookV5.Lifecycle.Locked));

        SwapParams memory swapParams = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        vm.expectRevert(CooketLaunchHookV5.PoolNotActive.selector);
        poolManager.swap(hook, address(this), canonicalKey, swapParams);

        vm.expectRevert(GraduationManagerV5.UnauthorizedLifecycleAuthority.selector);
        manager.armSettlement(canonicalKey, initialLiquidity, initialHookData);
        vm.prank(address(lifecycleAuthority));
        manager.armSettlement(canonicalKey, initialLiquidity, initialHookData);
        assertEq(uint8(hook.lifecycle(poolId)), uint8(ICooketLaunchHookV5.Lifecycle.Locked));

        vm.expectRevert(GraduationManagerV5.UnauthorizedLifecycleAuthority.selector);
        manager.registerCustody(canonicalKey);
        vm.expectRevert(GraduationManagerV5.UnauthorizedLifecycleAuthority.selector);
        manager.activatePool(canonicalKey);

        _assertProductionActiveUnreachable();
        assertFalse(custodian.executed());
    }

    function testManagerFailsClosedForDeferredSettlementOperations() public {
        assertEq(address(manager).balance, 0);
        assertEq(address(manager).code.length > 0, true);
        assertTrue(manager.hookBootstrapConsumed());
        vm.expectRevert(GraduationManagerV5.PoolInstructionMissing.selector);
        manager.executeInitialLiquidity(canonicalKey);
        vm.expectRevert(GraduationManagerV5.UnauthorizedLifecycleAuthority.selector);
        manager.registerCustody(canonicalKey);
        vm.expectRevert(GraduationManagerV5.UnauthorizedLifecycleAuthority.selector);
        manager.activatePool(canonicalKey);

        _registerAndInitialize();
        _assertProductionActiveUnreachable();
        assertEq(uint8(hook.lifecycle(canonicalKey.toId())), uint8(ICooketLaunchHookV5.Lifecycle.Locked));
    }

    function testActiveUnreachableWhenLiquidityIsInsufficient() public {
        _registerAndInitialize();
        ModifyLiquidityParams memory insufficient = initialLiquidity;
        insufficient.liquidityDelta = 1;
        vm.prank(address(lifecycleAuthority));
        manager.armSettlement(canonicalKey, insufficient, initialHookData);
        _assertProductionActiveUnreachable();
        _assertHookNotArmed();
    }

    function testActiveUnreachableWhenTokenAllocationIsIncorrect() public {
        _registerAndInitialize();
        bytes memory incorrectAllocation =
            abi.encode(EndpointConstantsV5.LP_ALLOCATION - 1, EndpointConstantsV5.GRADUATION_NATIVE_USDC_RESERVE);
        vm.prank(address(lifecycleAuthority));
        manager.armSettlement(canonicalKey, initialLiquidity, incorrectAllocation);
        _assertProductionActiveUnreachable();
        _assertHookNotArmed();
    }

    function testActiveUnreachableWhenUsdcAmountIsIncorrect() public {
        _registerAndInitialize();
        bytes memory incorrectUsdc =
            abi.encode(EndpointConstantsV5.LP_ALLOCATION, EndpointConstantsV5.GRADUATION_NATIVE_USDC_RESERVE - 1);
        vm.prank(address(lifecycleAuthority));
        manager.armSettlement(canonicalKey, initialLiquidity, incorrectUsdc);
        _assertProductionActiveUnreachable();
        _assertHookNotArmed();
    }

    function testActiveUnreachableWhenTicksOrSaltAreIncorrect() public {
        _registerAndInitialize();
        ModifyLiquidityParams memory incorrectTicks = initialLiquidity;
        incorrectTicks.tickLower = -400;
        incorrectTicks.tickUpper = 400;
        incorrectTicks.salt = keccak256("wrong-salt");
        vm.prank(address(lifecycleAuthority));
        manager.armSettlement(canonicalKey, incorrectTicks, initialHookData);
        _assertProductionActiveUnreachable();
        _assertHookNotArmed();
    }

    function testActiveUnreachableWhenCustodianDidNotCreatePosition() public {
        _registerAndInitialize();
        vm.prank(address(lifecycleAuthority));
        manager.armSettlement(canonicalKey, initialLiquidity, initialHookData);

        MockCodeV5 attacker = new MockCodeV5();
        vm.expectRevert(
            abi.encodeWithSelector(
                CooketLaunchHookV5.InvalidLifecycle.selector,
                ICooketLaunchHookV5.Lifecycle.SettlementArmed,
                ICooketLaunchHookV5.Lifecycle.Locked
            )
        );
        poolManager.addLiquidity(hook, address(attacker), canonicalKey, initialLiquidity, initialHookData);
        vm.expectRevert(
            abi.encodeWithSelector(
                CooketLaunchHookV5.InvalidLifecycle.selector,
                ICooketLaunchHookV5.Lifecycle.SettlementArmed,
                ICooketLaunchHookV5.Lifecycle.Locked
            )
        );
        poolManager.addLiquidity(hook, address(custodian), canonicalKey, initialLiquidity, initialHookData);
        assertFalse(custodian.executed());
        _assertProductionActiveUnreachable();
        _assertHookNotArmed();
    }

    function testActiveUnreachableWhenCustodyVerificationIsAbsent() public {
        _registerAndInitialize();
        vm.prank(address(lifecycleAuthority));
        manager.armSettlement(canonicalKey, initialLiquidity, initialHookData);
        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                CooketLaunchHookV5.InvalidLifecycle.selector,
                ICooketLaunchHookV5.Lifecycle.InitialLiquidityAdded,
                ICooketLaunchHookV5.Lifecycle.Locked
            )
        );
        hook.registerCustody(canonicalKey);
        _assertProductionActiveUnreachable();
        _assertHookNotArmed();
    }

    function testActiveUnreachableWhenSettlementExecutionIsIncomplete() public {
        _registerAndInitialize();
        vm.prank(address(lifecycleAuthority));
        vm.expectRevert(GraduationManagerV5.PoolActivationDeferred.selector);
        manager.activatePool(canonicalKey);
        assertEq(uint8(hook.lifecycle(canonicalKey.toId())), uint8(ICooketLaunchHookV5.Lifecycle.Locked));
        _assertProductionActiveUnreachable();
    }

    function testActiveUnreachableWhileProductionDependenciesRemainMocks() public {
        _registerAndInitialize();
        vm.prank(address(lifecycleAuthority));
        manager.armSettlement(canonicalKey, initialLiquidity, initialHookData);
        assertTrue(address(custodian).code.length > 0);
        assertFalse(custodian.executed());
        vm.expectRevert(GraduationManagerV5.SettlementExecutionDeferred.selector);
        manager.executeInitialLiquidity(canonicalKey);
        assertFalse(custodian.executed());
        _assertProductionActiveUnreachable();
        _assertHookNotArmed();
    }

    function testFuzzActiveUnreachableForArbitrarySettlementParams(
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta,
        bytes32 salt,
        uint256 tokenAmount,
        uint256 usdcAmount
    ) public {
        _registerAndInitialize();
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: liquidityDelta, salt: salt
        });
        bytes memory hookData = abi.encode(tokenAmount, usdcAmount);
        vm.prank(address(lifecycleAuthority));
        if (liquidityDelta <= 0) {
            vm.expectRevert(GraduationManagerV5.InvalidPoolLifecycle.selector);
            manager.armSettlement(canonicalKey, params, hookData);
        } else {
            manager.armSettlement(canonicalKey, params, hookData);
        }
        _assertProductionActiveUnreachable();
        _assertHookNotArmed();
        assertFalse(custodian.executed());
    }

    function _registerAndInitialize() internal {
        vm.prank(address(lifecycleAuthority));
        manager.registerPool(canonicalKey, address(token), INITIAL_PRICE, address(custodian));
        vm.prank(address(lifecycleAuthority));
        manager.initializePool(canonicalKey);
    }

    function _assertProductionActiveUnreachable() internal {
        PoolId poolId = canonicalKey.toId();
        uint8 before = uint8(hook.lifecycle(poolId));
        assertTrue(before != uint8(ICooketLaunchHookV5.Lifecycle.Active));

        vm.expectRevert(GraduationManagerV5.SettlementExecutionDeferred.selector);
        manager.executeInitialLiquidity(canonicalKey);

        vm.prank(address(lifecycleAuthority));
        vm.expectRevert(GraduationManagerV5.CustodyVerificationDeferred.selector);
        manager.registerCustody(canonicalKey);

        vm.prank(address(lifecycleAuthority));
        vm.expectRevert(GraduationManagerV5.PoolActivationDeferred.selector);
        manager.activatePool(canonicalKey);

        assertEq(uint8(hook.lifecycle(poolId)), before);
        assertTrue(uint8(hook.lifecycle(poolId)) != uint8(ICooketLaunchHookV5.Lifecycle.Active));

        SwapParams memory swapParams = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        vm.expectRevert(CooketLaunchHookV5.PoolNotActive.selector);
        poolManager.swap(hook, address(this), canonicalKey, swapParams);
    }

    function _assertHookNotArmed() internal view {
        assertEq(uint8(hook.lifecycle(canonicalKey.toId())), uint8(ICooketLaunchHookV5.Lifecycle.Locked));
    }

    function _deployHook(address managerAddress, uint256 startingSalt) internal returns (CooketLaunchHookV5 deployed) {
        bytes memory creationCode =
            abi.encodePacked(type(CooketLaunchHookV5).creationCode, abi.encode(address(poolManager), managerAddress));
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
