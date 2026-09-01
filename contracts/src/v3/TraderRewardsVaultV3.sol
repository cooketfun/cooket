// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {IPermanentLPFeeVaultV3} from "./interfaces/IPermanentLPFeeVaultV3.sol";
import {ITraderRewardsDistributorV3} from "./interfaces/ITraderRewardsDistributorV3.sol";
import {ITraderRewardsVaultV3} from "./interfaces/ITraderRewardsVaultV3.sol";
import {EndpointConstantsV3} from "./libraries/EndpointConstantsV3.sol";

/// @notice Global custody for policy-agnostic trader rewards.
contract TraderRewardsVaultV3 is ITraderRewardsVaultV3, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");

    address public immutable override feeManager;
    address public override distributor;
    address public override permanentLPFeeVault;
    address public override bootstrapAuthority;
    mapping(address launchToken => mapping(address asset => uint256 amount)) public override accrued;
    mapping(address asset => uint256 amount) public override totalAccrued;

    constructor(address governance, address feeManager_) {
        if (
            governance == address(0) || feeManager_ == address(0) || feeManager_.code.length == 0
                || IFeeManagerV3(feeManager_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || IFeeManagerV3(feeManager_).feePolicyHash() != EndpointConstantsV3.FEE_POLICY_HASH
        ) revert InvalidDependency();
        feeManager = feeManager_;
        bootstrapAuthority = governance;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function feePolicyHash() external pure override returns (bytes32) {
        return EndpointConstantsV3.FEE_POLICY_HASH;
    }

    function setDistributorOnce(address distributor_) external override {
        if (distributor != address(0)) revert DistributorAlreadySet();
        _requireBootstrap();
        if (
            distributor_ == address(0) || distributor_.code.length == 0
                || ITraderRewardsDistributorV3(distributor_).rewardsVault() != address(this)
                || ITraderRewardsDistributorV3(distributor_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ITraderRewardsDistributorV3(distributor_).feePolicyHash() != EndpointConstantsV3.FEE_POLICY_HASH
        ) revert InvalidDependency();
        distributor = distributor_;
        _consumeBootstrapIfComplete();
        emit DistributorSet(distributor_);
    }

    function setPermanentLPFeeVaultOnce(address vault) external override {
        if (permanentLPFeeVault != address(0)) revert LPFeeVaultAlreadySet();
        _requireBootstrap();
        if (
            vault == address(0) || vault.code.length == 0
                || IPermanentLPFeeVaultV3(vault).traderRewardsVault() != address(this)
                || IPermanentLPFeeVaultV3(vault).feeManager() != feeManager
                || IPermanentLPFeeVaultV3(vault).feePolicyHash() != EndpointConstantsV3.FEE_POLICY_HASH
        ) revert InvalidDependency();
        permanentLPFeeVault = vault;
        _consumeBootstrapIfComplete();
        emit PermanentLPFeeVaultSet(vault);
    }

    function depositNative(address launchToken) external payable override {
        if (msg.sender != feeManager) revert UnauthorizedFundingSource();
        if (launchToken == address(0) || msg.value == 0) revert InvalidAmount();
        accrued[launchToken][address(0)] += msg.value;
        totalAccrued[address(0)] += msg.value;
        emit TraderRewardsFunded(launchToken, address(0), msg.sender, msg.value);
    }

    function recordERC20Funding(address launchToken, address asset, uint256 amount) external override nonReentrant {
        if (msg.sender != permanentLPFeeVault || permanentLPFeeVault == address(0)) {
            revert UnauthorizedFundingSource();
        }
        if (launchToken == address(0) || asset == address(0) || amount == 0) revert InvalidAmount();
        uint256 required = totalAccrued[asset] + amount;
        uint256 available = IERC20(asset).balanceOf(address(this));
        if (available < required) revert InsufficientBacking(asset, available, required);
        accrued[launchToken][asset] += amount;
        totalAccrued[asset] = required;
        emit TraderRewardsFunded(launchToken, asset, msg.sender, amount);
    }

    function payout(address launchToken, address asset, address claimant, uint256 amount)
        external
        override
        nonReentrant
    {
        if (msg.sender != distributor || distributor == address(0)) revert UnauthorizedDistributor();
        if (claimant == address(0) || amount == 0) revert InvalidAmount();
        uint256 available = accrued[launchToken][asset];
        if (amount > available) revert InsufficientRewardsBalance();
        accrued[launchToken][asset] = available - amount;
        totalAccrued[asset] -= amount;
        if (asset == address(0)) {
            (bool success,) = payable(claimant).call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(claimant, amount);
        }
        emit TraderRewardPaid(launchToken, asset, claimant, amount);
    }

    function _requireBootstrap() private view {
        if (msg.sender != bootstrapAuthority || bootstrapAuthority == address(0)) revert UnauthorizedBootstrap();
    }

    function _consumeBootstrapIfComplete() private {
        if (distributor != address(0) && permanentLPFeeVault != address(0)) bootstrapAuthority = address(0);
    }

    receive() external payable {
        revert UnauthorizedFundingSource();
    }
}
