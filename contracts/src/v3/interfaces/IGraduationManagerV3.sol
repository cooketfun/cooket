// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Versioned Stage 2B trust boundary. A concrete manager must create
/// and initialize the canonical token/WETH pool from `registerLaunch`, in the
/// same transaction as launch, rather than waiting until graduation.
interface IGraduationManagerV3 {
    enum PoolCandidateState {
        NoPool,
        Uninitialized,
        InitializedExactPrice,
        IncorrectPrice,
        NonzeroLiquidity,
        Malformed
    }

    error AlreadyGraduated();
    error FactoryAlreadySet();
    error FactoryNotSet();
    error InvalidCreator();
    error InvalidCurve();
    error InvalidFactory();
    error InvalidToken();
    error LaunchAlreadyRegistered();
    error LaunchNotRegistered();
    error LaunchRelationshipMismatch();
    error UnauthorizedBootstrap();
    error UnauthorizedCurve();
    error UnauthorizedFactory();
    error FactoryVersionMismatch();
    error InvalidPoolConfiguration();
    error UnsafePoolCandidate(PoolCandidateState state, address pool);
    error PoolReservationMismatch();

    event FactorySet(address indexed factory);
    event FactoryBootstrapConsumed(address indexed previousBootstrapAuthority);
    event LaunchRegistered(
        address indexed token,
        address indexed curve,
        address indexed creator,
        address pool,
        bytes32 launchSeed,
        bytes32 candidateSalt,
        uint16 attemptIndex
    );

    function setFactoryOnce(address factory_) external;
    function registerLaunch(
        address token,
        address curve,
        address creator,
        bytes32 launchSeed,
        bytes32 candidateSalt,
        uint16 attemptIndex
    ) external returns (address pool);
    function graduate(address token, address creator, uint256 tokenAmount, uint256 ethAmount) external payable;

    function factory() external view returns (address);
    function factoryBootstrapAuthority() external view returns (address);
    function protocolVersionHash() external pure returns (bytes32);
    function classifyPoolCandidate(address token) external view returns (PoolCandidateState state, address pool);
    function expectedSqrtPriceX96(address token) external view returns (uint160);
    function canonicalPoolOf(address token) external view returns (address);
    function uniswapV3Factory() external view returns (address);
    function weth() external view returns (address);
    function residualEscrowOf(address token) external view returns (address);
    function launchOf(address token)
        external
        view
        returns (address curve, address creator, bool registered, bool graduated);
    function launchSelectionOf(address token)
        external
        view
        returns (address pool, bytes32 launchSeed, bytes32 candidateSalt, uint16 attemptIndex);
}
