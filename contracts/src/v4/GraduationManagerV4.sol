// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GraduationManagerV4Boundary} from "./GraduationManagerV4Boundary.sol";
import {INonfungiblePositionManagerV3} from "../v3/interfaces/INonfungiblePositionManagerV3.sol";
import {IPermanentLPFeeVaultV4} from "./interfaces/IPermanentLPFeeVaultV4.sol";
import {IPermanentLPCustodianDeployerV4} from "./interfaces/IPermanentLPCustodianDeployerV4.sol";
import {IPermanentLPCustodianV4} from "./interfaces/IPermanentLPCustodianV4.sol";
import {IPermanentResidualEscrowV4} from "./interfaces/IPermanentResidualEscrowV4.sol";
import {IGraduationSettlementExecutorV4} from "./interfaces/IGraduationSettlementExecutorV4.sol";
import {IUniswapV3PoolMinimal} from "../v3/interfaces/uniswap/IUniswapV3PoolMinimal.sol";
import {EndpointConstantsV4} from "./libraries/EndpointConstantsV4.sol";
import {ArcNativeUsdcV4} from "./libraries/ArcNativeUsdcV4.sol";
import {PermanentResidualEscrowV4} from "./PermanentResidualEscrowV4.sol";

/// @notice One-shot canonical endpoint settlement; dependencies are bootstrap-bound once after factory binding.
contract GraduationManagerV4 is GraduationManagerV4Boundary, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public dependencyBootstrapAuthority;
    address public override permanentLPFeeVault;
    address public override permanentLPCustodianDeployer;
    address public nonfungiblePositionManager;
    address public settlementExecutor;
    mapping(address => bool) public override settled;
    mapping(address => address) public override residualEscrowOf;
    event DependenciesBound(address indexed vault, address indexed deployer, address indexed positionManager);
    event GraduatedV4(address indexed token, address indexed custodian, uint256 indexed tokenId, uint128 liquidity);
    error DependenciesAlreadyBound();
    error DependenciesNotBound();
    error UnauthorizedDependencyBootstrap();
    error InvalidDependency();
    error SettlementMismatch();

    constructor(address uniswapFactory_, address canonicalUsdc_, address governance_)
        GraduationManagerV4Boundary(uniswapFactory_, canonicalUsdc_, governance_)
    {
        dependencyBootstrapAuthority = governance_;
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
        address executor = IPermanentLPCustodianDeployerV4(deployer).settlementExecutor();
        if (
            executor == address(0) || executor.code.length == 0
                || IGraduationSettlementExecutorV4(executor).graduationManager() != address(this)
                || IGraduationSettlementExecutorV4(executor).nonfungiblePositionManager() != positionManager
                || IGraduationSettlementExecutorV4(executor).canonicalUsdc() != canonicalUsdc
                || IGraduationSettlementExecutorV4(executor).protocolVersionHash() != PROTOCOL_VERSION_HASH
        ) revert InvalidDependency();
        if (
            IPermanentLPFeeVaultV4(vault).factory() != factory
                || IPermanentLPFeeVaultV4(vault).graduationManager() != address(this)
                || IPermanentLPFeeVaultV4(vault).canonicalUsdc() != canonicalUsdc
                || IPermanentLPCustodianDeployerV4(deployer).feeVault() != vault
                || IPermanentLPCustodianDeployerV4(deployer).graduationManager() != address(this)
                || IPermanentLPCustodianDeployerV4(deployer).nonfungiblePositionManager() != positionManager
                || INonfungiblePositionManagerV3(positionManager).factory() != uniswapV3Factory
        ) revert InvalidDependency();
        if (IPermanentLPFeeVaultV4(vault).permanentLPCustodianDeployer() != address(0)) {
            revert InvalidDependency();
        }
        // The vault deliberately accepts this handshake only from this manager.
        // Keeping the call here makes the complete bootstrap one atomic operation.
        IPermanentLPFeeVaultV4(vault).setPermanentLPCustodianDeployerOnce(deployer);
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
            settled[token] || msg.value != nativeUsdcAmount || tokenAmount != EndpointConstantsV4.LP_ALLOCATION
                || nativeUsdcAmount != EndpointConstantsV4.GRADUATION_NATIVE_USDC_RESERVE
                || IERC20(token).balanceOf(address(this)) != tokenAmount
        ) revert SettlementMismatch();
        address pool = canonicalPoolOf[token];
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        uint160 expectedSqrtPriceX96 = expectedSqrtPriceX96(token);
        if (sqrtPriceX96 != expectedSqrtPriceX96) revert SettlementMismatch();
        (address custodian, uint256 id, uint128 liquidity) = _settle(token, tokenAmount, nativeUsdcAmount);
        IPermanentLPCustodianV4(custodian).bindPosition(id);
        settled[token] = true;
        emit GraduatedV4(token, custodian, id, liquidity);
    }

    function _settle(address token, uint256 tokenAmount, uint256 nativeUsdcAmount)
        private
        returns (address custodian, uint256 id, uint128 liquidity)
    {
        custodian = IPermanentLPCustodianDeployerV4(permanentLPCustodianDeployer).custodianOf(token);
        if (custodian == address(0)) {
            custodian = IPermanentLPCustodianDeployerV4(permanentLPCustodianDeployer).deployCustodian(token);
        }
        PermanentResidualEscrowV4 residualEscrow =
            new PermanentResidualEscrowV4(token, address(this), settlementExecutor, canonicalUsdc);
        residualEscrowOf[token] = address(residualEscrow);
        IERC20(token).safeTransfer(settlementExecutor, tokenAmount);
        uint256 managerNativeBalanceBefore = address(this).balance;
        IGraduationSettlementExecutorV4.SettlementResult memory result = IGraduationSettlementExecutorV4(
            settlementExecutor
        )
        .execute{value: nativeUsdcAmount}(
            token, custodian, tokenAmount, nativeUsdcAmount, address(residualEscrow)
        );
        id = result.tokenId;
        liquidity = result.liquidity;
        if (result.tokenResidual != 0) {
            IPermanentResidualEscrowV4(address(residualEscrow)).deposit(token, result.tokenResidual);
        }
        if (result.usdcResidual6 != 0) {
            IPermanentResidualEscrowV4(address(residualEscrow)).deposit(canonicalUsdc, result.usdcResidual6);
        }
        if (
            result.nativeUsdcDust18 != 0 || IERC20(token).balanceOf(address(this)) != 0
                || address(this).balance != managerNativeBalanceBefore - nativeUsdcAmount
                || ArcNativeUsdcV4.nativeUsdcToUsdc6Exact(nativeUsdcAmount) != 14_490_000_000
        ) {
            revert SettlementMismatch();
        }
    }
}
