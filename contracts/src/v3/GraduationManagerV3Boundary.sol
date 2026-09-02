// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGraduationManagerV3} from "./interfaces/IGraduationManagerV3.sol";
import {ICooketCurveV3} from "./interfaces/ICooketCurveV3.sol";
import {ICooketFactoryV3} from "./interfaces/ICooketFactoryV3.sol";
import {ICooketTokenV3} from "./interfaces/ICooketTokenV3.sol";
import {IUniswapV3FactoryMinimal} from "./interfaces/uniswap/IUniswapV3FactoryMinimal.sol";
import {IUniswapV3PoolMinimal} from "./interfaces/uniswap/IUniswapV3PoolMinimal.sol";
import {ArcNativeUsdcV3} from "./libraries/ArcNativeUsdcV3.sol";

/// @notice Shared immutable registration and authentication boundary for a
/// Arc endpoint-cp-v3 graduation manager. It reserves and initializes the
/// canonical launch-token/USDC pool during launch, before third parties can choose its price.
/// @dev Stage 2B must not assume this pool still has zero liquidity or that its
/// spot price remains unchanged at graduation. Permissionless liquidity and
/// manipulation require a separate audited graduation policy.
abstract contract GraduationManagerV3Boundary is IGraduationManagerV3 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");
    bytes32 public constant ARC_PROTOCOL_DOMAIN = keccak256("COOKET_ARC_V1");
    uint24 public constant POOL_FEE = 10_000;
    int24 public constant POOL_TICK_SPACING = 200;
    /// @dev floor(sqrt((36_225 / 1e21) * 2^192)); launch token (18 decimals) is token0.
    uint160 public constant SQRT_PRICE_X96_TOKEN0_LAUNCH = 476_852_189_220_498_924_480;
    /// @dev floor(sqrt((1e21 / 36_225) * 2^192)); canonical USDC (6 decimals) is token0.
    uint160 public constant SQRT_PRICE_X96_TOKEN0_USDC = 13_163_621_510_572_779_143_698_740_160_447_723_801;

    struct Launch {
        address curve;
        address creator;
        address pool;
        bytes32 launchSeed;
        bytes32 candidateSalt;
        uint16 attemptIndex;
        bool registered;
        bool graduated;
    }

    address public immutable override uniswapV3Factory;
    address public constant override canonicalUsdc = ArcNativeUsdcV3.CANONICAL_USDC;
    address public override factory;
    address public override factoryBootstrapAuthority;
    mapping(address token => Launch launch) internal _launches;
    mapping(address token => address pool) public override canonicalPoolOf;

    constructor(address uniswapV3Factory_) {
        if (uniswapV3Factory_ == address(0) || uniswapV3Factory_.code.length == 0 || canonicalUsdc.code.length == 0) {
            revert InvalidPoolConfiguration();
        }
        if (IUniswapV3FactoryMinimal(uniswapV3Factory_).feeAmountTickSpacing(POOL_FEE) != POOL_TICK_SPACING) {
            revert InvalidPoolConfiguration();
        }
        uniswapV3Factory = uniswapV3Factory_;
        factoryBootstrapAuthority = msg.sender;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function setFactoryOnce(address factory_) external override {
        if (factory != address(0)) revert FactoryAlreadySet();
        if (msg.sender != factoryBootstrapAuthority || factoryBootstrapAuthority == address(0)) {
            revert UnauthorizedBootstrap();
        }
        if (factory_ == address(0) || factory_.code.length == 0) revert InvalidFactory();
        if (ICooketFactoryV3(factory_).protocolVersionHash() != PROTOCOL_VERSION_HASH) {
            revert FactoryVersionMismatch();
        }

        address consumedAuthority = factoryBootstrapAuthority;
        factory = factory_;
        factoryBootstrapAuthority = address(0);
        emit FactorySet(factory_);
        emit FactoryBootstrapConsumed(consumedAuthority);
    }

    function registerLaunch(
        address token,
        address curve,
        address creator,
        bytes32 launchSeed,
        bytes32 candidateSalt,
        uint16 attemptIndex
    ) external override returns (address pool) {
        if (factory == address(0)) revert FactoryNotSet();
        if (msg.sender != factory) revert UnauthorizedFactory();
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        if (curve == address(0) || curve.code.length == 0) revert InvalidCurve();
        if (creator == address(0)) revert InvalidCreator();
        if (_launches[token].registered) revert LaunchAlreadyRegistered();

        (address registeredCreator, address registeredCurve) = ICooketFactoryV3(factory).tokenInfo(token);
        if (
            !ICooketFactoryV3(factory).isToken(token) || ICooketFactoryV3(factory).curveOf(token) != curve
                || registeredCurve != curve || registeredCreator != creator
                || ICooketCurveV3(curve).factory() != factory || ICooketCurveV3(curve).token() != token
                || ICooketCurveV3(curve).creator() != creator || ICooketTokenV3(token).factory() != factory
                || ICooketTokenV3(token).creator() != creator || !ICooketTokenV3(token).initialized()
        ) revert LaunchRelationshipMismatch();

        _beforePoolReservation(token);
        pool = _reserveCanonicalPool(token);
        _launches[token] = Launch({
            curve: curve,
            creator: creator,
            pool: pool,
            launchSeed: launchSeed,
            candidateSalt: candidateSalt,
            attemptIndex: attemptIndex,
            registered: true,
            graduated: false
        });
        canonicalPoolOf[token] = pool;
        _afterLaunchRegistered(token, curve, creator);
        emit LaunchRegistered(token, curve, creator, pool, launchSeed, candidateSalt, attemptIndex);
    }

    function expectedSqrtPriceX96(address token) public view override returns (uint160) {
        if (token == address(0) || token == canonicalUsdc) revert InvalidToken();
        return token < canonicalUsdc ? SQRT_PRICE_X96_TOKEN0_LAUNCH : SQRT_PRICE_X96_TOKEN0_USDC;
    }

    /// @notice Classifies only canonical pool state. ERC20 balance donations are intentionally ignored.
    /// @dev Any initialized result is unsafe for candidate selection. A zero
    /// active-liquidity value cannot disprove out-of-range positions.
    function classifyPoolCandidate(address token)
        public
        view
        override
        returns (PoolCandidateState state, address pool)
    {
        if (token == address(0) || token == canonicalUsdc) {
            return (PoolCandidateState.Malformed, address(0));
        }

        (bool poolLookupOk, bytes memory poolData) = uniswapV3Factory.staticcall(
            abi.encodeCall(IUniswapV3FactoryMinimal.getPool, (token, canonicalUsdc, POOL_FEE))
        );
        if (!poolLookupOk || poolData.length < 32) return (PoolCandidateState.Malformed, address(0));
        uint256 rawPool;
        assembly ("memory-safe") {
            rawPool := mload(add(poolData, 32))
        }
        if (rawPool > type(uint160).max) return (PoolCandidateState.Malformed, address(0));
        // forge-lint: disable-next-line(unsafe-typecast)
        pool = address(uint160(rawPool));
        if (pool == address(0)) return (PoolCandidateState.NoPool, address(0));
        if (pool.code.length == 0) return (PoolCandidateState.Malformed, pool);

        (address token0, address token1) = token < canonicalUsdc ? (token, canonicalUsdc) : (canonicalUsdc, token);
        if (
            _readAddress(pool, IUniswapV3PoolMinimal.factory.selector) != uniswapV3Factory
                || _readAddress(pool, IUniswapV3PoolMinimal.token0.selector) != token0
                || _readAddress(pool, IUniswapV3PoolMinimal.token1.selector) != token1
                || _readUint(pool, IUniswapV3PoolMinimal.fee.selector) != POOL_FEE
                || _readUint(pool, IUniswapV3PoolMinimal.tickSpacing.selector) != 200
        ) return (PoolCandidateState.Malformed, pool);

        (bool liquidityOk, uint256 liquidityValue) = _tryReadUint(pool, IUniswapV3PoolMinimal.liquidity.selector);
        (bool slotOk, uint160 sqrtPriceX96) = _tryReadSqrtPrice(pool);
        if (!liquidityOk || !slotOk) return (PoolCandidateState.Malformed, pool);
        if (liquidityValue != 0) return (PoolCandidateState.NonzeroLiquidity, pool);
        if (sqrtPriceX96 == 0) return (PoolCandidateState.Uninitialized, pool);
        if (sqrtPriceX96 == expectedSqrtPriceX96(token)) return (PoolCandidateState.InitializedExactPrice, pool);
        return (PoolCandidateState.IncorrectPrice, pool);
    }

    function launchOf(address token)
        external
        view
        override
        returns (address curve, address creator, bool registered, bool graduated)
    {
        Launch storage launch = _launches[token];
        return (launch.curve, launch.creator, launch.registered, launch.graduated);
    }

    function launchSelectionOf(address token)
        external
        view
        override
        returns (address pool, bytes32 launchSeed, bytes32 candidateSalt, uint16 attemptIndex)
    {
        Launch storage launch = _launches[token];
        return (launch.pool, launch.launchSeed, launch.candidateSalt, launch.attemptIndex);
    }

    function _authorizeGraduation(address token, address creator) internal {
        Launch storage launch = _launches[token];
        if (!launch.registered) revert LaunchNotRegistered();
        if (msg.sender != launch.curve) revert UnauthorizedCurve();
        if (creator != launch.creator) revert LaunchRelationshipMismatch();
        if (launch.graduated) revert AlreadyGraduated();
        launch.graduated = true;
    }

    function _reserveCanonicalPool(address token) private returns (address pool) {
        (PoolCandidateState state, address classifiedPool) = classifyPoolCandidate(token);
        if (state == PoolCandidateState.NoPool) {
            pool = IUniswapV3FactoryMinimal(uniswapV3Factory).createPool(token, canonicalUsdc, POOL_FEE);
            if (pool == address(0)) revert PoolReservationMismatch();
            IUniswapV3PoolMinimal(pool).initialize(expectedSqrtPriceX96(token));
        } else if (state == PoolCandidateState.Uninitialized) {
            pool = classifiedPool;
            IUniswapV3PoolMinimal(pool).initialize(expectedSqrtPriceX96(token));
        } else {
            revert UnsafePoolCandidate(state, classifiedPool);
        }

        (PoolCandidateState finalState, address finalPool) = classifyPoolCandidate(token);
        // The pool may be initialized only by this reservation call. A pool
        // already initialized before entry is always rejected above because
        // active liquidity cannot prove that no out-of-range positions exist.
        if (finalState != PoolCandidateState.InitializedExactPrice || finalPool != pool) {
            revert PoolReservationMismatch();
        }
    }

    function _readAddress(address target, bytes4 selector) private view returns (address value) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || data.length < 32) return address(0);
        uint256 rawValue;
        assembly ("memory-safe") {
            rawValue := mload(add(data, 32))
        }
        if (rawValue > type(uint160).max) return address(0);
        // forge-lint: disable-next-line(unsafe-typecast)
        value = address(uint160(rawValue));
    }

    function _readUint(address target, bytes4 selector) private view returns (uint256 value) {
        (, value) = _tryReadUint(target, selector);
    }

    function _tryReadUint(address target, bytes4 selector) private view returns (bool ok, uint256 value) {
        bytes memory data;
        (ok, data) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || data.length < 32) return (false, 0);
        value = abi.decode(data, (uint256));
    }

    function _tryReadSqrtPrice(address pool) private view returns (bool ok, uint160 sqrtPriceX96) {
        bytes memory data;
        (ok, data) = pool.staticcall(abi.encodeWithSelector(IUniswapV3PoolMinimal.slot0.selector));
        if (!ok || data.length < 224) return (false, 0);
        uint256 rawSqrtPriceX96;
        assembly ("memory-safe") {
            rawSqrtPriceX96 := mload(add(data, 32))
        }
        if (rawSqrtPriceX96 > type(uint160).max) return (false, 0);
        // forge-lint: disable-next-line(unsafe-typecast)
        sqrtPriceX96 = uint160(rawSqrtPriceX96);
    }

    function _afterLaunchRegistered(address token, address curve, address creator) internal virtual {}
    function _beforePoolReservation(address token) internal virtual {}
}
