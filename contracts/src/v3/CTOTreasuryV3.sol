// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICTORegistryV3} from "./interfaces/ICTORegistryV3.sol";
import {ICTOTreasuryV3} from "./interfaces/ICTOTreasuryV3.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {ICooketFactoryV3} from "./interfaces/ICooketFactoryV3.sol";
import {IGraduationManagerV3} from "./interfaces/IGraduationManagerV3.sol";
import {IPermanentLPFeeVaultV3} from "./interfaces/IPermanentLPFeeVaultV3.sol";

/// @notice Immutable, Safe-controlled custody for one voluntary CTO token.
contract CTOTreasuryV3 is ICTOTreasuryV3, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant CTO_POLICY_HASH = keccak256("cooket-voluntary-cto-v1");

    address public immutable override registry;
    address public immutable override launchToken;
    address public immutable override controller;
    address public immutable override canonicalUsdc;
    mapping(address asset => bool supported) private _additionalSupportedAsset;

    constructor(address registry_, address launchToken_, address controller_, address canonicalUsdc_) {
        if (registry_ == address(0) || msg.sender != registry_) revert InvalidRegistry();
        if (launchToken_ == address(0) || launchToken_.code.length == 0) revert InvalidAsset();
        if (controller_ == address(0) || controller_.code.length == 0) revert InvalidController();
        if (canonicalUsdc_ == address(0) || canonicalUsdc_.code.length == 0) revert InvalidAsset();
        registry = registry_;
        launchToken = launchToken_;
        controller = controller_;
        canonicalUsdc = canonicalUsdc_;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert UnauthorizedController();
        _;
    }

    function ctoPolicyHash() external pure override returns (bytes32) {
        return CTO_POLICY_HASH;
    }

    function acceptCTO(bytes32 proposalId) external override onlyController {
        ICTORegistryV3(registry).acceptCTO(proposalId);
        emit CTOAcceptanceSubmitted(proposalId, controller, address(this));
    }

    function isSupportedAsset(address asset) public view override returns (bool) {
        return asset == address(0) || asset == canonicalUsdc || asset == launchToken || _additionalSupportedAsset[asset];
    }

    function registerSupportedAsset(address asset) external override onlyController {
        if (asset == address(0) || asset.code.length == 0) revert InvalidAsset();
        if (isSupportedAsset(asset)) revert InvalidAsset();
        _additionalSupportedAsset[asset] = true;
        emit SupportedAssetRegistered(asset, msg.sender);
    }

    function transferAsset(address asset, address recipient, uint256 amount)
        external
        override
        onlyController
        nonReentrant
    {
        _requireActive();
        if (!isSupportedAsset(asset)) revert UnsupportedAsset();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (asset == address(0)) {
            (bool success,) = payable(recipient).call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
        emit TreasuryAssetTransferred(asset, recipient, amount, msg.sender);
    }

    function pullCurveCreatorFees() external override nonReentrant returns (uint256 amount) {
        _requireActive();
        IFeeManagerV3 fees = IFeeManagerV3(ICTORegistryV3(registry).feeManager());
        amount = fees.claimCreatorFees(launchToken);
        if (amount == 0) revert NothingToPull();
        emit CreatorFeesPulled(launchToken, address(0), amount, msg.sender);
    }

    function pullLPCreatorFees(address asset) external override nonReentrant returns (uint256 amount) {
        _requireActive();
        if (asset != launchToken && asset != canonicalUsdc) revert UnsupportedAsset();
        IFeeManagerV3 fees = IFeeManagerV3(ICTORegistryV3(registry).feeManager());
        address factory = fees.factory();
        address manager = address(ICooketFactoryV3(factory).graduationManager());
        address vault = IGraduationManagerV3(manager).permanentLPFeeVault();
        (uint256 protocolAmount, uint256 creatorAmount) = IPermanentLPFeeVaultV3(vault).claimLPFees(asset);
        if (protocolAmount != 0) revert ProtocolFeesMixed();
        if (creatorAmount == 0) revert NothingToPull();
        amount = creatorAmount;
        emit CreatorFeesPulled(launchToken, asset, amount, msg.sender);
    }

    function _requireActive() private view {
        IFeeManagerV3 fees = IFeeManagerV3(ICTORegistryV3(registry).feeManager());
        if (!fees.ctoActive(launchToken) || fees.ctoTreasuryOf(launchToken) != address(this)) revert CTOInactive();
    }

    receive() external payable {}
}
