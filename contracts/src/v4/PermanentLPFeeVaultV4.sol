// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFeeManagerV4} from "./interfaces/IFeeManagerV4.sol";
import {IGraduationManagerV4} from "./interfaces/IGraduationManagerV4.sol";
import {INonfungiblePositionManagerV3} from "../v3/interfaces/INonfungiblePositionManagerV3.sol";
import {IPermanentLPCustodianV4} from "./interfaces/IPermanentLPCustodianV4.sol";
import {IPermanentLPCustodianDeployerV4} from "./interfaces/IPermanentLPCustodianDeployerV4.sol";
import {IPermanentLPFeeVaultV4} from "./interfaces/IPermanentLPFeeVaultV4.sol";
import {ITokenCommunityVaultV4} from "./interfaces/ITokenCommunityVaultV4.sol";
import {ITraderRewardsVaultV4} from "./interfaces/ITraderRewardsVaultV4.sol";
import {ICooketFactoryV4} from "./interfaces/ICooketFactoryV4.sol";
import {CanonicalPositionV3} from "../v3/libraries/CanonicalPositionV3.sol";
import {EndpointConstantsV4} from "./libraries/EndpointConstantsV4.sol";

/// @notice Immutable, asset-backed custody of fees earned only by canonical permanent LP NFTs.
contract PermanentLPFeeVaultV4 is IPermanentLPFeeVaultV4, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v4");

    address public immutable override factory;
    address public immutable override feeManager;
    address public immutable override graduationManager;
    address public immutable override canonicalUsdc;
    address public immutable override communityVault;
    address public immutable override traderRewardsVault;
    address public override permanentLPCustodianDeployer;
    address public override custodianDeployerBootstrapAuthority;

    mapping(address recipient => mapping(address asset => uint256 amount)) public override protocolLPFeesAccrued;
    mapping(address recipient => mapping(address asset => uint256 amount)) public override creatorLPFeesAccrued;
    mapping(address launchToken => mapping(address asset => uint256 amount)) public override communityLPFeesAccrued;
    mapping(address launchToken => mapping(address asset => uint256 amount)) public override traderRewardsLPFeesAccrued;
    mapping(address asset => uint256 amount) public override totalLPFeesAccrued;

    constructor(
        address graduationManager_,
        address feeManager_,
        address communityVault_,
        address traderRewardsVault_,
        address canonicalUsdc_
    ) {
        if (
            graduationManager_ == address(0) || graduationManager_.code.length == 0 || feeManager_ == address(0)
                || feeManager_.code.length == 0
        ) revert InvalidCustodianDeployer();
        if (
            communityVault_ == address(0) || communityVault_.code.length == 0 || traderRewardsVault_ == address(0)
                || traderRewardsVault_.code.length == 0
        ) revert InvalidEcosystemVault();
        IGraduationManagerV4 manager = IGraduationManagerV4(graduationManager_);
        IFeeManagerV4 fees = IFeeManagerV4(feeManager_);
        address factory_ = manager.factory();
        if (
            factory_ == address(0) || factory_.code.length == 0 || canonicalUsdc_ == address(0)
                || canonicalUsdc_.code.length == 0 || manager.canonicalUsdc() != canonicalUsdc_
                || manager.protocolVersionHash() != keccak256("endpoint-cp-v4")
                || fees.protocolVersionHash() != keccak256("endpoint-cp-v4") || fees.factory() != factory_
                || address(ICooketFactoryV4(factory_).graduationManager()) != graduationManager_
        ) {
            revert InvalidCustodianDeployer();
        }
        if (
            fees.feePolicyHash() != EndpointConstantsV4.FEE_POLICY_HASH || fees.communityVault() != communityVault_
                || fees.traderRewardsVault() != traderRewardsVault_
                || ITokenCommunityVaultV4(communityVault_).feeManager() != feeManager_
                || ITraderRewardsVaultV4(traderRewardsVault_).feeManager() != feeManager_
                || ITokenCommunityVaultV4(communityVault_).protocolVersionHash() != keccak256("endpoint-cp-v4")
                || ITraderRewardsVaultV4(traderRewardsVault_).protocolVersionHash() != keccak256("endpoint-cp-v4")
                || ITokenCommunityVaultV4(communityVault_).feePolicyHash() != EndpointConstantsV4.FEE_POLICY_HASH
                || ITraderRewardsVaultV4(traderRewardsVault_).feePolicyHash() != EndpointConstantsV4.FEE_POLICY_HASH
        ) revert InvalidEcosystemVault();
        canonicalUsdc = canonicalUsdc_;
        factory = factory_;
        feeManager = feeManager_;
        graduationManager = graduationManager_;
        communityVault = communityVault_;
        traderRewardsVault = traderRewardsVault_;
        custodianDeployerBootstrapAuthority = graduationManager_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function feePolicyHash() external pure override returns (bytes32) {
        return EndpointConstantsV4.FEE_POLICY_HASH;
    }

    function setPermanentLPCustodianDeployerOnce(address deployer) external override {
        if (permanentLPCustodianDeployer != address(0)) revert CustodianDeployerAlreadySet();
        if (msg.sender != custodianDeployerBootstrapAuthority || custodianDeployerBootstrapAuthority == address(0)) {
            revert UnauthorizedBootstrap();
        }
        if (deployer == address(0) || deployer.code.length == 0) revert InvalidCustodianDeployer();
        IPermanentLPCustodianDeployerV4 custodyDeployer = IPermanentLPCustodianDeployerV4(deployer);
        address positionManager = custodyDeployer.nonfungiblePositionManager();
        if (
            custodyDeployer.protocolVersionHash() != PROTOCOL_VERSION_HASH
                || custodyDeployer.feeVault() != address(this)
                || custodyDeployer.graduationManager() != graduationManager || custodyDeployer.factory() != factory
                || custodyDeployer.canonicalUsdc() != canonicalUsdc || positionManager == address(0)
                || positionManager.code.length == 0
                || INonfungiblePositionManagerV3(positionManager).factory()
                    != IGraduationManagerV4(graduationManager).uniswapV3Factory()
        ) revert InvalidCustodianDeployer();
        permanentLPCustodianDeployer = deployer;
        custodianDeployerBootstrapAuthority = address(0);
        emit PermanentLPCustodianDeployerSet(deployer);
    }

    function notifyPermanentLPFees(address launchToken, uint256 amount0, uint256 amount1) external override {
        address deployer = permanentLPCustodianDeployer;
        if (deployer == address(0) || launchToken == address(0)) revert UnauthorizedPermanentCustodian();
        IPermanentLPCustodianDeployerV4 custodyDeployer = IPermanentLPCustodianDeployerV4(deployer);
        if (msg.sender != custodyDeployer.custodianOf(launchToken) || msg.sender.code.length == 0) {
            revert UnauthorizedPermanentCustodian();
        }
        IPermanentLPCustodianV4 custodian = IPermanentLPCustodianV4(msg.sender);
        if (
            custodian.protocolVersionHash() != PROTOCOL_VERSION_HASH || !custodian.positionRegistered()
                || custodian.launchToken() != launchToken || custodian.feeVault() != address(this)
                || custodian.canonicalUsdc() != canonicalUsdc || custodian.canonicalFactory() != factory
                || custodian.graduationManager() != graduationManager
                || custodian.nonfungiblePositionManager() != custodyDeployer.nonfungiblePositionManager()
        ) revert UnauthorizedPermanentCustodian();
        if (amount0 == 0 && amount1 == 0) return;

        address protocolRecipient = IFeeManagerV4(feeManager).treasury();
        address creatorRecipient = IFeeManagerV4(feeManager).creatorPayoutOf(launchToken);
        (address curve, address creator, bool registered,) =
            IGraduationManagerV4(graduationManager).launchOf(launchToken);
        if (
            protocolRecipient == address(0) || creatorRecipient == address(0) || !registered || curve == address(0)
                || creator == address(0) || IFeeManagerV4(feeManager).curveOf(launchToken) != curve
                || IFeeManagerV4(feeManager).creatorOf(launchToken) != creator
        ) revert UnauthorizedPermanentCustodian();
        (address token0, address token1) =
            launchToken < canonicalUsdc ? (launchToken, canonicalUsdc) : (canonicalUsdc, launchToken);
        if (!CanonicalPositionV3.isCanonicalFullRangePosition(
                custodian.nonfungiblePositionManager(), custodian.positionTokenId(), token0, token1
            )) {
            revert UnauthorizedPermanentCustodian();
        }
        _requireBacking(token0, amount0);
        _requireBacking(token1, amount1);
        _accrue(launchToken, msg.sender, token0, amount0, protocolRecipient, creatorRecipient);
        _accrue(launchToken, msg.sender, token1, amount1, protocolRecipient, creatorRecipient);
    }

    function claimLPFees(address asset)
        external
        override
        nonReentrant
        returns (uint256 protocolAmount, uint256 creatorAmount)
    {
        if (asset == address(0)) revert InvalidLPFeeAsset();
        protocolAmount = protocolLPFeesAccrued[msg.sender][asset];
        creatorAmount = creatorLPFeesAccrued[msg.sender][asset];
        uint256 total = protocolAmount + creatorAmount;
        if (total == 0) revert NothingToClaimLPFees();
        if (protocolAmount != 0) {
            protocolLPFeesAccrued[msg.sender][asset] = 0;
            emit ProtocolLPFeesClaimed(msg.sender, asset, protocolAmount);
        }
        if (creatorAmount != 0) {
            creatorLPFeesAccrued[msg.sender][asset] = 0;
            emit CreatorLPFeesClaimed(msg.sender, asset, creatorAmount);
        }
        totalLPFeesAccrued[asset] -= total;
        IERC20(asset).safeTransfer(msg.sender, total);
    }

    function fundCommunityVault(address launchToken, address asset)
        external
        override
        nonReentrant
        returns (uint256 amount)
    {
        if (asset == address(0)) revert InvalidLPFeeAsset();
        amount = communityLPFeesAccrued[launchToken][asset];
        if (amount == 0) revert NothingToClaimLPFees();
        communityLPFeesAccrued[launchToken][asset] = 0;
        totalLPFeesAccrued[asset] -= amount;
        uint256 balanceBefore = IERC20(asset).balanceOf(communityVault);
        IERC20(asset).safeTransfer(communityVault, amount);
        if (IERC20(asset).balanceOf(communityVault) != balanceBefore + amount) revert InvalidEcosystemVault();
        ITokenCommunityVaultV4(communityVault).recordERC20Funding(launchToken, asset, amount);
        emit CommunityLPFeesForwarded(launchToken, asset, communityVault, amount, msg.sender);
    }

    function fundTraderRewardsVault(address launchToken, address asset)
        external
        override
        nonReentrant
        returns (uint256 amount)
    {
        if (asset == address(0)) revert InvalidLPFeeAsset();
        amount = traderRewardsLPFeesAccrued[launchToken][asset];
        if (amount == 0) revert NothingToClaimLPFees();
        traderRewardsLPFeesAccrued[launchToken][asset] = 0;
        totalLPFeesAccrued[asset] -= amount;
        uint256 balanceBefore = IERC20(asset).balanceOf(traderRewardsVault);
        IERC20(asset).safeTransfer(traderRewardsVault, amount);
        if (IERC20(asset).balanceOf(traderRewardsVault) != balanceBefore + amount) revert InvalidEcosystemVault();
        ITraderRewardsVaultV4(traderRewardsVault).recordERC20Funding(launchToken, asset, amount);
        emit TraderRewardsLPFeesForwarded(launchToken, asset, traderRewardsVault, amount, msg.sender);
    }

    function _requireBacking(address asset, uint256 amount) private view {
        uint256 required = totalLPFeesAccrued[asset] + amount;
        uint256 available = IERC20(asset).balanceOf(address(this));
        if (available < required) revert InsufficientLPFeeBacking(asset, available, required);
    }

    function _accrue(
        address launchToken,
        address custodian,
        address asset,
        uint256 amount,
        address protocolRecipient,
        address creatorRecipient
    ) private {
        if (amount == 0) return;
        uint256 creatorShare =
            Math.mulDiv(amount, EndpointConstantsV4.LP_CREATOR_FEE_PERCENT, EndpointConstantsV4.FEE_SPLIT_DENOMINATOR);
        uint256 communityShare = Math.mulDiv(
            amount, EndpointConstantsV4.LP_COMMUNITY_FEE_PERCENT, EndpointConstantsV4.FEE_SPLIT_DENOMINATOR
        );
        uint256 traderRewardsShare = Math.mulDiv(
            amount, EndpointConstantsV4.LP_TRADER_REWARDS_FEE_PERCENT, EndpointConstantsV4.FEE_SPLIT_DENOMINATOR
        );
        uint256 protocolShare = amount - creatorShare - communityShare - traderRewardsShare;
        protocolLPFeesAccrued[protocolRecipient][asset] += protocolShare;
        creatorLPFeesAccrued[creatorRecipient][asset] += creatorShare;
        communityLPFeesAccrued[launchToken][asset] += communityShare;
        traderRewardsLPFeesAccrued[launchToken][asset] += traderRewardsShare;
        totalLPFeesAccrued[asset] += amount;
        emit PermanentLPFeesAccrued(
            launchToken,
            custodian,
            asset,
            protocolRecipient,
            creatorRecipient,
            creatorShare,
            protocolShare,
            communityShare,
            traderRewardsShare
        );
    }
}
