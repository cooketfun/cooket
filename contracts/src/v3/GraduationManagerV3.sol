// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GraduationManagerV3Boundary} from "./GraduationManagerV3Boundary.sol";
import {INonfungiblePositionManagerV3} from "./interfaces/INonfungiblePositionManagerV3.sol";
import {IPermanentLPFeeVaultV3} from "./interfaces/IPermanentLPFeeVaultV3.sol";
import {IPermanentLPCustodianDeployerV3} from "./interfaces/IPermanentLPCustodianDeployerV3.sol";
import {IPermanentLPCustodianV3} from "./interfaces/IPermanentLPCustodianV3.sol";
import {IPermanentResidualEscrowV3} from "./interfaces/IPermanentResidualEscrowV3.sol";
import {IGraduationSettlementExecutorV3} from "./interfaces/IGraduationSettlementExecutorV3.sol";
import {IUniswapV3PoolMinimal} from "./interfaces/uniswap/IUniswapV3PoolMinimal.sol";
import {EndpointConstantsV3} from "./libraries/EndpointConstantsV3.sol";
import {ArcNativeUsdcV3} from "./libraries/ArcNativeUsdcV3.sol";
import {PermanentResidualEscrowV3} from "./PermanentResidualEscrowV3.sol";

/// @notice One-shot canonical endpoint settlement; dependencies are bootstrap-bound once after factory binding.
contract GraduationManagerV3 is GraduationManagerV3Boundary, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public dependencyBootstrapAuthority;
    address public permanentLPFeeVault;
    address public permanentLPCustodianDeployer;
    address public nonfungiblePositionManager;
    address public settlementExecutor;
    mapping(address => bool) public settled;
    mapping(address => address) public override residualEscrowOf;
    event DependenciesBound(address indexed vault, address indexed deployer, address indexed positionManager);
    event GraduatedV3(address indexed token, address indexed custodian, uint256 indexed tokenId, uint128 liquidity);
    error DependenciesAlreadyBound();
    error DependenciesNotBound();
    error UnauthorizedDependencyBootstrap();
    error InvalidDependency();
    error SettlementMismatch();

    constructor(address uniswapFactory_) GraduationManagerV3Boundary(uniswapFactory_) {
        dependencyBootstrapAuthority = msg.sender;
    }

    function bindDependenciesOnce(address vault, address deployer, address positionManager) external {
        if (permanentLPFeeVault != address(0)) revert DependenciesAlreadyBound();
        if (
            msg.sender != dependencyBootstrapAuthority || dependencyBootstrapAuthority == address(0)
                || factory == address(0)
        ) revert UnauthorizedDependencyBootstrap();
        if (
            vault == address(0) || deployer == address(0) || positionManager == address(0) || vault.code.length == 0
                || deployer.code.length == 0 || positionManager.code.length == 0
        ) revert InvalidDependency();
        address executor = IPermanentLPCustodianDeployerV3(deployer).settlementExecutor();
        if (
            executor == address(0) || executor.code.length == 0
                || IGraduationSettlementExecutorV3(executor).graduationManager() != address(this)
                || IGraduationSettlementExecutorV3(executor).nonfungiblePositionManager() != positionManager
                || IGraduationSettlementExecutorV3(executor).canonicalUsdc() != canonicalUsdc
        ) revert InvalidDependency();
        if (
            IPermanentLPFeeVaultV3(vault).factory() != factory
                || IPermanentLPFeeVaultV3(vault).graduationManager() != address(this)
                || IPermanentLPFeeVaultV3(vault).canonicalUsdc() != canonicalUsdc
                || IPermanentLPCustodianDeployerV3(deployer).feeVault() != vault
                || IPermanentLPCustodianDeployerV3(deployer).graduationManager() != address(this)
                || IPermanentLPCustodianDeployerV3(deployer).nonfungiblePositionManager() != positionManager
                || INonfungiblePositionManagerV3(positionManager).factory() != uniswapV3Factory
        ) revert InvalidDependency();
        if (IPermanentLPFeeVaultV3(vault).permanentLPCustodianDeployer() != address(0)) {
            revert InvalidDependency();
        }
        // The vault deliberately accepts this handshake only from this manager.
        // Keeping the call here makes the complete bootstrap one atomic operation.
        IPermanentLPFeeVaultV3(vault).setPermanentLPCustodianDeployerOnce(deployer);
        permanentLPFeeVault = vault;
        permanentLPCustodianDeployer = deployer;
        nonfungiblePositionManager = positionManager;
        settlementExecutor = executor;
        dependencyBootstrapAuthority = address(0);
        emit DependenciesBound(vault, deployer, positionManager);
    }

    function graduate(address token, address creator, uint256 tokenAmount, uint256 nativeUsdcAmount)
        external
        payable
        override
        nonReentrant
    {
        if (permanentLPFeeVault == address(0)) revert DependenciesNotBound();
        _authorizeGraduation(token, creator);
        if (
            settled[token] || msg.value != nativeUsdcAmount || tokenAmount != EndpointConstantsV3.LP_ALLOCATION
                || nativeUsdcAmount != EndpointConstantsV3.GRADUATION_NATIVE_USDC_RESERVE
                || IERC20(token).balanceOf(address(this)) != tokenAmount
        ) revert SettlementMismatch();
        address pool = canonicalPoolOf[token];
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 expectedSqrtPriceX96 = expectedSqrtPriceX96(token);
        if (sqrtPriceX96 != expectedSqrtPriceX96) revert SettlementMismatch();
        (address custodian, uint256 id, uint128 liquidity) = _settle(token, tokenAmount, nativeUsdcAmount);
        IPermanentLPCustodianV3(custodian).bindPosition(id);
        settled[token] = true;
        emit GraduatedV3(token, custodian, id, liquidity);
    }

    function _settle(address token, uint256 tokenAmount, uint256 nativeUsdcAmount)
        private
        returns (address custodian, uint256 id, uint128 liquidity)
    {
        custodian = IPermanentLPCustodianDeployerV3(permanentLPCustodianDeployer).custodianOf(token);
        if (custodian == address(0)) {
            custodian = IPermanentLPCustodianDeployerV3(permanentLPCustodianDeployer).deployCustodian(token);
        }
        PermanentResidualEscrowV3 residualEscrow =
            new PermanentResidualEscrowV3(token, address(this), settlementExecutor);
        residualEscrowOf[token] = address(residualEscrow);
        IERC20(token).safeTransfer(settlementExecutor, tokenAmount);
        uint256 managerNativeBalanceBefore = address(this).balance;
        IGraduationSettlementExecutorV3.SettlementResult memory result = IGraduationSettlementExecutorV3(
            settlementExecutor
        )
        .execute{value: nativeUsdcAmount}(
            token, custodian, tokenAmount, nativeUsdcAmount, address(residualEscrow)
        );
        id = result.tokenId;
        liquidity = result.liquidity;
        if (result.tokenResidual != 0) {
            IPermanentResidualEscrowV3(address(residualEscrow)).deposit(token, result.tokenResidual);
        }
        if (result.usdcResidual6 != 0) {
            IPermanentResidualEscrowV3(address(residualEscrow)).deposit(canonicalUsdc, result.usdcResidual6);
        }
        if (
            result.nativeUsdcDust18 != 0 || IERC20(token).balanceOf(address(this)) != 0
                || address(this).balance != managerNativeBalanceBefore - nativeUsdcAmount
                || ArcNativeUsdcV3.nativeUsdcToUsdc6Exact(nativeUsdcAmount) != 7_245_000_000
        ) {
            revert SettlementMismatch();
        }
    }
}
