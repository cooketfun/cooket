// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {IPermanentLPFeeVaultV3} from "./interfaces/IPermanentLPFeeVaultV3.sol";
import {ITokenCommunityVaultV3} from "./interfaces/ITokenCommunityVaultV3.sol";
import {EndpointConstantsV3} from "./libraries/EndpointConstantsV3.sol";

/// @notice Global custody for Community allocations, preserving launch-token and asset provenance.
contract TokenCommunityVaultV3 is ITokenCommunityVaultV3, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");
    uint64 public constant TREASURY_ROTATION_DELAY = 48 hours;

    address public immutable override feeManager;
    address public override permanentLPFeeVault;
    address public override lpFeeVaultBootstrapAuthority;
    address public override treasury;
    address public override pendingTreasury;
    uint64 public override pendingTreasuryAcceptAfter;
    mapping(address launchToken => mapping(address asset => uint256 amount)) public override accrued;
    mapping(address asset => uint256 amount) public override totalAccrued;

    constructor(address governance, address initialTreasury, address feeManager_) Ownable(governance) {
        if (initialTreasury == address(0)) revert InvalidTreasury();
        if (
            feeManager_ == address(0) || feeManager_.code.length == 0
                || IFeeManagerV3(feeManager_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || IFeeManagerV3(feeManager_).feePolicyHash() != EndpointConstantsV3.FEE_POLICY_HASH
        ) revert InvalidDependency();
        treasury = initialTreasury;
        feeManager = feeManager_;
        lpFeeVaultBootstrapAuthority = governance;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function feePolicyHash() external pure override returns (bytes32) {
        return EndpointConstantsV3.FEE_POLICY_HASH;
    }

    function setPermanentLPFeeVaultOnce(address vault) external override {
        if (permanentLPFeeVault != address(0)) revert LPFeeVaultAlreadySet();
        if (msg.sender != lpFeeVaultBootstrapAuthority || lpFeeVaultBootstrapAuthority == address(0)) {
            revert UnauthorizedBootstrap();
        }
        if (
            vault == address(0) || vault.code.length == 0
                || IPermanentLPFeeVaultV3(vault).communityVault() != address(this)
                || IPermanentLPFeeVaultV3(vault).feeManager() != feeManager
                || IPermanentLPFeeVaultV3(vault).feePolicyHash() != EndpointConstantsV3.FEE_POLICY_HASH
        ) revert InvalidDependency();
        permanentLPFeeVault = vault;
        lpFeeVaultBootstrapAuthority = address(0);
        emit PermanentLPFeeVaultSet(vault);
    }

    function depositNative(address launchToken) external payable override {
        if (msg.sender != feeManager) revert UnauthorizedFundingSource();
        if (launchToken == address(0) || msg.value == 0) revert InvalidAmount();
        accrued[launchToken][address(0)] += msg.value;
        totalAccrued[address(0)] += msg.value;
        emit CommunityFunded(launchToken, address(0), msg.sender, msg.value);
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
        emit CommunityFunded(launchToken, asset, msg.sender, amount);
    }

    function forwardToTreasury(address launchToken, address asset)
        external
        override
        nonReentrant
        returns (uint256 amount)
    {
        amount = accrued[launchToken][asset];
        if (amount == 0) revert NothingToForward();
        accrued[launchToken][asset] = 0;
        totalAccrued[asset] -= amount;
        address recipient = treasury;
        if (asset == address(0)) {
            (bool success,) = payable(recipient).call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
        emit CommunityFundsForwarded(launchToken, asset, recipient, amount, msg.sender);
    }

    function proposeTreasury(address proposedTreasury) external override onlyOwner {
        if (proposedTreasury == address(0)) revert InvalidTreasury();
        if (proposedTreasury == treasury) revert TreasuryUnchanged();
        uint64 acceptAfter = uint64(block.timestamp + TREASURY_ROTATION_DELAY);
        pendingTreasury = proposedTreasury;
        pendingTreasuryAcceptAfter = acceptAfter;
        emit TreasuryProposed(treasury, proposedTreasury, acceptAfter);
    }

    function acceptTreasury() external override {
        address proposedTreasury = pendingTreasury;
        if (msg.sender != proposedTreasury || proposedTreasury == address(0)) revert UnauthorizedPendingTreasury();
        if (block.timestamp < pendingTreasuryAcceptAfter) revert TreasuryDelayNotElapsed();
        address previousTreasury = treasury;
        treasury = proposedTreasury;
        delete pendingTreasury;
        delete pendingTreasuryAcceptAfter;
        emit TreasuryAccepted(previousTreasury, proposedTreasury);
    }

    function cancelTreasuryProposal() external override onlyOwner {
        address cancelledTreasury = pendingTreasury;
        if (cancelledTreasury == address(0)) revert NoPendingProposal();
        delete pendingTreasury;
        delete pendingTreasuryAcceptAfter;
        emit TreasuryProposalCancelled(cancelledTreasury);
    }

    function _transferOwnership(address newOwner) internal override {
        address cancelledTreasury = pendingTreasury;
        if (cancelledTreasury != address(0)) {
            delete pendingTreasury;
            delete pendingTreasuryAcceptAfter;
            emit TreasuryProposalInvalidated(cancelledTreasury, newOwner);
        }
        super._transferOwnership(newOwner);
    }

    receive() external payable {
        revert UnauthorizedFundingSource();
    }
}
