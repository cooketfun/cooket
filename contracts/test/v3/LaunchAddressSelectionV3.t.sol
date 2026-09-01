// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveDeployerV3} from "../../src/v3/CurveDeployerV3.sol";
import {EndpointConstantsV3} from "../../src/v3/libraries/EndpointConstantsV3.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {TokenDeployerV3} from "../../src/v3/TokenDeployerV3.sol";
import {CooketCurveV3} from "../../src/v3/CooketCurveV3.sol";
import {CooketFactoryV3} from "../../src/v3/CooketFactoryV3.sol";
import {CooketTokenV3} from "../../src/v3/CooketTokenV3.sol";
import {ICurveDeployerV3} from "../../src/v3/interfaces/ICurveDeployerV3.sol";
import {IGraduationManagerV3} from "../../src/v3/interfaces/IGraduationManagerV3.sol";
import {ITokenDeployerV3} from "../../src/v3/interfaces/ITokenDeployerV3.sol";
import {ICooketFactoryV3} from "../../src/v3/interfaces/ICooketFactoryV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";
import {MockGraduationManagerV3} from "./mocks/MockGraduationManagerV3.sol";
import {MockConfiguredUniswapV3PoolV3, MockUniswapV3FactoryV3, MockUniswapV3PoolV3} from "./mocks/MockUniswapV3.sol";

contract LaunchAddressSelectionV3Test is CooketV3TestBase {
    uint256 private constant EIP_170_MAX = 24_576;
    uint256 private constant EIP_3860_MAX = 49_152;
    uint256 private constant CONSERVATIVE_TRANSACTION_GAS_CAP = 16_777_216;
    uint256 private constant Q192 = 1 << 192;

    TokenDeployerV3 private deployer;

    struct LaunchEventData {
        string version;
        uint256 supply;
        uint256 curveAllocation;
        uint256 lpAllocation;
        address payout;
        address pool;
        bytes32 launchSeed;
        bytes32 candidateSalt;
        uint16 attemptIndex;
    }

    function setUp() public override {
        super.setUp();
        deployer = TokenDeployerV3(factory.tokenDeployer());
    }

    function testCreate2AddressMatchesIndependentComputation() public view {
        bytes32 userSalt = keccak256("independent-address");
        bytes32 launchSeed = deployer.computeLaunchSeed(creator, userSalt, "Independent", "IND");
        bytes32 candidateSalt = deployer.computeCandidateSalt(launchSeed, 0);
        address reported = deployer.computeTokenAddress(creator, "Independent", "IND", candidateSalt);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(CooketTokenV3).creationCode, abi.encode(address(factory), creator, "Independent", "IND")
            )
        );
        address independentlyComputed = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(deployer), candidateSalt, initCodeHash))))
        );
        assertEq(reported, independentlyComputed);
    }

    function testDifferentUserSaltsProduceDifferentCandidateSequences() public view {
        bytes32 seedA = deployer.computeLaunchSeed(creator, keccak256("salt-a"), "Salted", "SLT");
        bytes32 seedB = deployer.computeLaunchSeed(creator, keccak256("salt-b"), "Salted", "SLT");
        assertNotEq(seedA, seedB);
        assertNotEq(deployer.computeCandidateSalt(seedA, 0), deployer.computeCandidateSalt(seedB, 0));
    }

    function testLaunchPriceConstantsAreIndependentlyDerivedForBothOrderings() public view {
        uint256 terminalPriceWeiPerToken = EndpointConstantsV3.TERMINAL_PRICE;
        uint256 token0LaunchRatioX192 = Math.mulDiv(terminalPriceWeiPerToken, Q192, 1 ether);
        uint256 token0WethRatioX192 = Math.mulDiv(1 ether, Q192, terminalPriceWeiPerToken);
        uint256 derivedToken0Launch = Math.sqrt(token0LaunchRatioX192);
        uint256 derivedToken0Weth = Math.sqrt(token0WethRatioX192);

        assertEq(derivedToken0Launch, 9_703_428_570_912_459_262_669_888);
        assertEq(derivedToken0Weth, 646_895_238_060_830_617_511_325_894_307_352);
        assertLe(derivedToken0Launch * derivedToken0Launch, token0LaunchRatioX192);
        assertGt((derivedToken0Launch + 1) * (derivedToken0Launch + 1), token0LaunchRatioX192);
        assertLe(derivedToken0Weth * derivedToken0Weth, token0WethRatioX192);
        assertGt((derivedToken0Weth + 1) * (derivedToken0Weth + 1), token0WethRatioX192);

        uint256 launchTokenAsToken0Price = Math.mulDiv(derivedToken0Launch * derivedToken0Launch, 1 ether, Q192);
        uint256 wethAsToken0Price = Math.mulDiv(Q192, 1 ether, derivedToken0Weth * derivedToken0Weth);
        assertEq(launchTokenAsToken0Price, terminalPriceWeiPerToken - 1);
        assertEq(wethAsToken0Price, terminalPriceWeiPerToken);
        assertLe(terminalPriceWeiPerToken - launchTokenAsToken0Price, 1);
        assertLe(wethAsToken0Price - terminalPriceWeiPerToken, 1);
        assertEq(terminalPriceWeiPerToken * 1_000_000_000, 15 ether);
        assertEq(EndpointConstantsV3.INITIAL_PRICE * 1_000_000_000, 0.9375 ether);

        address below = address(uint160(uint160(address(weth)) - 1));
        address above = address(uint160(uint160(address(weth)) + 1));
        assertLt(uint160(below), uint160(address(weth)));
        assertGt(uint160(above), uint160(address(weth)));
        assertEq(graduationManager.expectedSqrtPriceX96(below), 9_703_428_570_912_459_262_669_888);
        assertEq(graduationManager.expectedSqrtPriceX96(above), 646_895_238_060_830_617_511_325_894_307_352);
    }

    function testActualPoolReservationSupportsBothOrderingBranches() public {
        // Keep WETH below the CREATE2 token candidates without using Foundry's
        // reserved precompile-address range.
        address lowWeth = address(0x1_0000);
        address highWeth = address(type(uint160).max);
        vm.etch(lowWeth, hex"00");
        vm.etch(highWeth, hex"00");

        (CooketTokenV3 highToken, MockGraduationManagerV3 lowWethManager) =
            _launchOnFreshStack(lowWeth, "WETH First", "WF", keccak256("weth-first"));
        MockUniswapV3PoolV3 wethFirstPool = MockUniswapV3PoolV3(lowWethManager.canonicalPoolOf(address(highToken)));
        assertEq(wethFirstPool.token0(), lowWeth);
        assertEq(wethFirstPool.token1(), address(highToken));
        (uint160 wethFirstPrice,,,,,,) = wethFirstPool.slot0();
        assertEq(wethFirstPrice, 646_895_238_060_830_617_511_325_894_307_352);

        (CooketTokenV3 lowToken, MockGraduationManagerV3 highWethManager) =
            _launchOnFreshStack(highWeth, "Token First", "TF", keccak256("token-first"));
        MockUniswapV3PoolV3 tokenFirstPool = MockUniswapV3PoolV3(highWethManager.canonicalPoolOf(address(lowToken)));
        assertEq(tokenFirstPool.token0(), address(lowToken));
        assertEq(tokenFirstPool.token1(), highWeth);
        (uint160 tokenFirstPrice,,,,,,) = tokenFirstPool.slot0();
        assertEq(tokenFirstPrice, 9_703_428_570_912_459_262_669_888);
    }

    function testNoPoolCandidateIsSelectedAndReserved() public {
        (address predicted,,) = _candidate("No Pool", "NOP", keccak256("no-pool"), 0);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "No Pool", "NOP", keccak256("no-pool"));
        assertEq(address(launchedToken), predicted);
        address pool = graduationManager.canonicalPoolOf(predicted);
        assertTrue(pool != address(0));
        _assertExactPool(predicted, pool);
    }

    function testExistingUninitializedPoolIsAcceptedAndInitializedExactly() public {
        bytes32 salt = keccak256("uninitialized");
        (address predicted,,) = _candidate("Uninitialized", "UNI", salt, 0);
        address pool = uniswapFactory.createPool(predicted, address(weth), 10_000);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Uninitialized", "UNI", salt);
        assertEq(address(launchedToken), predicted);
        assertEq(graduationManager.canonicalPoolOf(predicted), pool);
        _assertExactPool(predicted, pool);
    }

    function testExistingInitializedExactPriceZeroActiveLiquidityPoolIsRejected() public {
        bytes32 salt = keccak256("exact-existing");
        (address first,,) = _candidate("Exact Existing", "EXT", salt, 0);
        _createInitializedCanonicalPool(first, false);
        (address second,,) = _candidate("Exact Existing", "EXT", salt, 1);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Exact Existing", "EXT", salt);
        assertEq(address(launchedToken), second);
        assertNotEq(address(launchedToken), first);
    }

    function testExistingInitializedExactPriceActiveLiquidityPoolIsRejected() public {
        bytes32 salt = keccak256("exact-active");
        (address first,,) = _candidate("Exact Active", "EXA", salt, 0);
        _createInitializedCanonicalPool(first, true);
        (address second,,) = _candidate("Exact Active", "EXA", salt, 1);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Exact Active", "EXA", salt);
        assertEq(address(launchedToken), second);
    }

    function testWrongPricePoolIsSkippedAndPublicSaltFrontRunRecovers() public {
        bytes32 salt = keccak256("public-front-run");
        (address first,,) = _candidate("Front Run", "FRT", salt, 0);
        address wrongPool = uniswapFactory.createPool(first, address(weth), 10_000);
        MockUniswapV3PoolV3(wrongPool).initialize(1);
        (address second,,) = _candidate("Front Run", "FRT", salt, 1);

        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Front Run", "FRT", salt);
        assertEq(address(launchedToken), second);
        assertNotEq(address(launchedToken), first);
    }

    function testNonzeroLiquidityPoolIsSkipped() public {
        bytes32 salt = keccak256("nonzero-liquidity");
        (address first,,) = _candidate("Liquidity", "LIQ", salt, 0);
        address occupied = uniswapFactory.createPool(first, address(weth), 10_000);
        MockUniswapV3PoolV3(occupied).setLiquidity(1);
        (address second,,) = _candidate("Liquidity", "LIQ", salt, 1);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Liquidity", "LIQ", salt);
        assertEq(address(launchedToken), second);
    }

    function testRawWethDonationDoesNotRejectPristinePool() public {
        bytes32 salt = keccak256("raw-donation");
        (address predicted,,) = _candidate("Donation", "DON", salt, 0);
        address pool = uniswapFactory.createPool(predicted, address(weth), 10_000);
        weth.mint(pool, 123 ether);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Donation", "DON", salt);
        assertEq(address(launchedToken), predicted);
    }

    function testFirstUnsafeSecondAccepted() public {
        bytes32 salt = keccak256("first-unsafe");
        (address first,,) = _candidate("Skip One", "SKP", salt, 0);
        _createInitializedCanonicalPool(first, false);
        (address second,,) = _candidate("Skip One", "SKP", salt, 1);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Skip One", "SKP", salt);
        assertEq(address(launchedToken), second);
    }

    function testIndex254UnsafeAndIndex255Accepted() public {
        bytes32 salt = keccak256("last-candidate");
        _occupyWithRealisticInitializedPools("Last Candidate", "LST", salt, 255);
        (address last,,) = _candidate("Last Candidate", "LST", salt, 255);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Last Candidate", "LST", salt);
        assertEq(address(launchedToken), last);
    }

    function testAll256UnsafeRollsBackAndFreshSaltSucceeds() public {
        bytes32 blockedSalt = keccak256("all-blocked");
        bytes32 launchSeed = deployer.computeLaunchSeed(creator, blockedSalt, "All Blocked", "BLK");
        (address first,,) = _candidate("All Blocked", "BLK", blockedSalt, 0);
        _occupyWithRealisticInitializedPools("All Blocked", "BLK", blockedSalt, 256);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ITokenDeployerV3.NoAcceptableTokenAddress.selector, launchSeed));
        factory.createToken("All Blocked", "BLK", blockedSalt);

        bytes32 definition = keccak256(abi.encode(creator, "All Blocked", "BLK"));
        assertEq(factory.definitionToken(definition), address(0));
        assertEq(feeManager.curveOf(first), address(0));
        assertEq(first.code.length, 0);

        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "All Blocked", "BLK", keccak256("fresh-after-blocked"));
        assertTrue(address(launchedToken) != address(0));
    }

    function testMalformedAndNoncanonicalPoolRelationshipsAreRejected() public {
        bytes32 salt = keccak256("relationship-rejections");
        for (uint16 i; i < 5; ++i) {
            (address candidate,,) = _candidate("Relationships", "REL", salt, i);
            (address token0, address token1) =
                candidate < address(weth) ? (candidate, address(weth)) : (address(weth), candidate);
            address configuredPool;
            if (i == 0) {
                configuredPool = address(this);
            } else if (i == 1) {
                configuredPool = address(
                    new MockConfiguredUniswapV3PoolV3(
                        address(0xBAD),
                        token0,
                        token1,
                        10_000,
                        200,
                        graduationManager.expectedSqrtPriceX96(candidate),
                        0
                    )
                );
            } else if (i == 2) {
                configuredPool = address(
                    new MockConfiguredUniswapV3PoolV3(
                        address(uniswapFactory),
                        token1,
                        token0,
                        10_000,
                        200,
                        graduationManager.expectedSqrtPriceX96(candidate),
                        0
                    )
                );
            } else if (i == 3) {
                configuredPool = address(
                    new MockConfiguredUniswapV3PoolV3(
                        address(uniswapFactory),
                        token0,
                        token1,
                        3_000,
                        200,
                        graduationManager.expectedSqrtPriceX96(candidate),
                        0
                    )
                );
            } else {
                configuredPool = address(
                    new MockConfiguredUniswapV3PoolV3(
                        address(uniswapFactory),
                        token0,
                        token1,
                        10_000,
                        60,
                        graduationManager.expectedSqrtPriceX96(candidate),
                        0
                    )
                );
            }
            uniswapFactory.forcePool(candidate, address(weth), 10_000, configuredPool);
        }
        (address accepted,,) = _candidate("Relationships", "REL", salt, 5);
        (CooketTokenV3 launchedToken,) = _launchWithSalt(creator, "Relationships", "REL", salt);
        assertEq(address(launchedToken), accepted);
    }

    function testRegistrationTimeRecheckRejectsChangedPoolStateAndRollsBack() public {
        bytes32 salt = keccak256("recheck");
        (address predicted,,) = _candidate("Recheck", "RCK", salt, 0);
        address pool = uniswapFactory.createPool(predicted, address(weth), 10_000);
        graduationManager.configurePoolMutation(pool, 1, 0);

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IGraduationManagerV3.UnsafePoolCandidate.selector,
                IGraduationManagerV3.PoolCandidateState.IncorrectPrice,
                pool
            )
        );
        factory.createToken("Recheck", "RCK", salt);

        (uint160 sqrtPriceX96,,,,,,) = MockUniswapV3PoolV3(pool).slot0();
        assertEq(sqrtPriceX96, 0);
        assertEq(predicted.code.length, 0);
        assertEq(factory.definitionToken(keccak256(abi.encode(creator, "Recheck", "RCK"))), address(0));
    }

    function testUnauthorizedDeployerCallsAndImmutableIdentities() public {
        vm.prank(buyer);
        vm.expectRevert(ITokenDeployerV3.UnauthorizedFactory.selector);
        deployer.deployToken(buyer, keccak256("unauthorized"), "Unauthorized", "UNA");

        CurveDeployerV3 curveChildDeployer = CurveDeployerV3(factory.curveDeployer());
        vm.prank(buyer);
        vm.expectRevert(ICurveDeployerV3.UnauthorizedFactory.selector);
        curveChildDeployer.deployCurve(address(token), buyer);

        assertEq(deployer.factory(), address(factory));
        assertEq(deployer.graduationManager(), address(graduationManager));
        assertEq(curveChildDeployer.factory(), address(factory));
        assertEq(curveChildDeployer.feeManager(), address(feeManager));
        assertEq(curveChildDeployer.graduationManager(), address(graduationManager));
    }

    function testZeroSaltAndDuplicateSuccessfulDefinitionReject() public {
        vm.prank(creator);
        vm.expectRevert(ICooketFactoryV3.InvalidUserSalt.selector);
        factory.createToken("Zero Salt", "ZER", bytes32(0));

        vm.prank(creator);
        vm.expectRevert(ICooketFactoryV3.DuplicateToken.selector);
        factory.createToken("Endpoint Cooket", "EPZ", keccak256("another-salt"));
    }

    function testStableLaunchEventContainsPoolAndSelectionData() public {
        bytes32 userSalt = keccak256("event-salt");
        vm.recordLogs();
        (CooketTokenV3 launchedToken, CooketCurveV3 launchedCurve) =
            _launchWithSalt(creator, "Event Token", "EVT", userSalt);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 signature = keccak256(
            "TokenLaunchedV3(address,address,address,string,uint256,uint256,uint256,address,address,bytes32,bytes32,uint16)"
        );
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length == 0 || logs[i].emitter != address(factory) || logs[i].topics[0] != signature) {
                continue;
            }
            assertEq(address(uint160(uint256(logs[i].topics[1]))), creator);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), address(launchedToken));
            assertEq(address(uint160(uint256(logs[i].topics[3]))), address(launchedCurve));
            LaunchEventData memory eventData =
                abi.decode(abi.encodePacked(uint256(32), logs[i].data), (LaunchEventData));
            assertEq(eventData.version, "endpoint-cp-v3");
            assertEq(eventData.supply, TOTAL_SUPPLY);
            assertEq(eventData.curveAllocation, CURVE_ALLOCATION);
            assertEq(eventData.lpAllocation, LP_ALLOCATION);
            assertEq(eventData.payout, creator);
            assertEq(eventData.pool, graduationManager.canonicalPoolOf(address(launchedToken)));
            assertEq(eventData.launchSeed, deployer.computeLaunchSeed(creator, userSalt, "Event Token", "EVT"));
            assertEq(
                eventData.candidateSalt, deployer.computeCandidateSalt(eventData.launchSeed, eventData.attemptIndex)
            );
            (address storedPool, bytes32 storedSeed, bytes32 storedSalt, uint16 storedAttempt) =
                graduationManager.launchSelectionOf(address(launchedToken));
            assertEq(storedPool, eventData.pool);
            assertEq(storedSeed, eventData.launchSeed);
            assertEq(storedSalt, eventData.candidateSalt);
            assertEq(storedAttempt, eventData.attemptIndex);
            found = true;
        }
        assertTrue(found);
    }

    function testRuntimeAndInitcodeSizeGates() public view {
        assertLt(address(factory).code.length, EIP_170_MAX - 2_000);
        assertLt(address(deployer).code.length, EIP_170_MAX - 2_000);
        assertLt(factory.curveDeployer().code.length, EIP_170_MAX - 2_000);
        assertLt(address(graduationManager).code.length, EIP_170_MAX - 2_000);
        assertLt(type(CooketFactoryV3).creationCode.length + 64, EIP_3860_MAX);
    }

    function testCandidateZeroLaunchGasBelowConservativeCap() public {
        _coolCandidatePath("Gas Success", "GAS", keccak256("gas-success"), 1);
        uint256 gasBefore = gasleft();
        _launchWithSalt(creator, "Gas Success", "GAS", keccak256("gas-success"));
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("successful launch gas", gasUsed);
        assertLt(gasUsed, CONSERVATIVE_TRANSACTION_GAS_CAP);
    }

    function testRealisticCandidate255LaunchGasBelowConservativeCap() public {
        bytes32 salt = keccak256("gas-last-candidate");
        _occupyWithRealisticInitializedPools("Gas Last", "GLS", salt, 255);
        _coolCandidatePath("Gas Last", "GLS", salt, 256);
        uint256 gasBefore = gasleft();
        _launchWithSalt(creator, "Gas Last", "GLS", salt);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("realistic index 255 launch gas", gasUsed);
        assertLt(gasUsed, CONSERVATIVE_TRANSACTION_GAS_CAP);
    }

    function testRealisticAll256RejectedGasBelowConservativeCap() public {
        bytes32 salt = keccak256("gas-all-rejected");
        bytes32 launchSeed = deployer.computeLaunchSeed(creator, salt, "Gas Revert", "GRV");
        _occupyWithRealisticInitializedPools("Gas Revert", "GRV", salt, 256);
        _coolCandidatePath("Gas Revert", "GRV", salt, 256);
        vm.prank(creator);
        uint256 gasBefore = gasleft();
        (bool ok, bytes memory returnData) =
            address(factory).call(abi.encodeCall(ICooketFactoryV3.createToken, ("Gas Revert", "GRV", salt)));
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("realistic all 256 rejected gas", gasUsed);
        assertFalse(ok);
        assertEq(bytes4(returnData), ITokenDeployerV3.NoAcceptableTokenAddress.selector);
        assertEq(abi.decode(_sliceAfterSelector(returnData), (bytes32)), launchSeed);
        assertLt(gasUsed, CONSERVATIVE_TRANSACTION_GAS_CAP);
    }

    function _launchWithSalt(address launchCreator, string memory name, string memory symbol, bytes32 userSalt)
        private
        returns (CooketTokenV3 launchedToken, CooketCurveV3 launchedCurve)
    {
        vm.prank(launchCreator);
        (address tokenAddress, address curveAddress) = factory.createToken(name, symbol, userSalt);
        return (CooketTokenV3(tokenAddress), CooketCurveV3(payable(curveAddress)));
    }

    function _candidate(string memory name, string memory symbol, bytes32 userSalt, uint16 attemptIndex)
        private
        view
        returns (address tokenAddress, bytes32 launchSeed, bytes32 candidateSalt)
    {
        launchSeed = deployer.computeLaunchSeed(creator, userSalt, name, symbol);
        candidateSalt = deployer.computeCandidateSalt(launchSeed, attemptIndex);
        tokenAddress = deployer.computeTokenAddress(creator, name, symbol, candidateSalt);
    }

    function _assertExactPool(address launchToken, address pool) private view {
        MockUniswapV3PoolV3 typedPool = MockUniswapV3PoolV3(pool);
        (uint160 sqrtPriceX96,,,,,,) = typedPool.slot0();
        assertEq(sqrtPriceX96, graduationManager.expectedSqrtPriceX96(launchToken));
        assertEq(typedPool.factory(), address(uniswapFactory));
        assertEq(typedPool.fee(), 10_000);
        assertEq(typedPool.tickSpacing(), 200);
        assertEq(typedPool.liquidity(), 0);
        assertEq(typedPool.token0(), launchToken < address(weth) ? launchToken : address(weth));
        assertEq(typedPool.token1(), launchToken < address(weth) ? address(weth) : launchToken);
    }

    function _createInitializedCanonicalPool(address candidate, bool activeLiquidity) private returns (address pool) {
        pool = uniswapFactory.createPool(candidate, address(weth), 10_000);
        MockUniswapV3PoolV3(pool).initialize(graduationManager.expectedSqrtPriceX96(candidate));
        if (activeLiquidity) MockUniswapV3PoolV3(pool).setLiquidity(1);
    }

    function _occupyWithRealisticInitializedPools(
        string memory name,
        string memory symbol,
        bytes32 userSalt,
        uint16 count
    ) private {
        for (uint16 i; i < count; ++i) {
            (address candidate,,) = _candidate(name, symbol, userSalt, i);
            _createInitializedCanonicalPool(candidate, false);
        }
    }

    function _coolCandidatePath(string memory name, string memory symbol, bytes32 userSalt, uint16 count) private {
        for (uint16 i; i < count; ++i) {
            (address candidate,,) = _candidate(name, symbol, userSalt, i);
            bytes32 poolKey = keccak256(
                abi.encode(
                    candidate < address(weth) ? candidate : address(weth),
                    candidate < address(weth) ? address(weth) : candidate,
                    uint24(10_000)
                )
            );
            bytes32 poolMappingSlot = keccak256(abi.encode(poolKey, uint256(0)));
            address pool = uniswapFactory.getPool(candidate, address(weth), 10_000);
            vm.cool(candidate);
            if (pool != address(0)) vm.cool(pool);
            vm.coolSlot(address(uniswapFactory), poolMappingSlot);
        }
        vm.cool(address(deployer));
        vm.cool(address(graduationManager));
        vm.cool(address(uniswapFactory));
        vm.cool(factory.curveDeployer());
        vm.cool(address(feeManager));
    }

    function _sliceAfterSelector(bytes memory data) private pure returns (bytes memory result) {
        result = new bytes(data.length - 4);
        for (uint256 i; i < result.length; ++i) {
            result[i] = data[i + 4];
        }
    }

    function _launchOnFreshStack(address wethAddress, string memory name, string memory symbol, bytes32 userSalt)
        private
        returns (CooketTokenV3 launchedToken, MockGraduationManagerV3 manager)
    {
        MockUniswapV3FactoryV3 uni = new MockUniswapV3FactoryV3();
        manager = new MockGraduationManagerV3(address(uni), wethAddress);
        FeeManagerV3 fees = new FeeManagerV3(address(this), treasury);
        CooketFactoryV3 launcher = new CooketFactoryV3(address(fees), address(manager));
        fees.setFactoryOnce(address(launcher));
        manager.setFactoryOnce(address(launcher));
        vm.prank(creator);
        (address tokenAddress,) = launcher.createToken(name, symbol, userSalt);
        launchedToken = CooketTokenV3(tokenAddress);
    }
}
