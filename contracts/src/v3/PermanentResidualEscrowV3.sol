// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPermanentResidualEscrowV3} from "./interfaces/IPermanentResidualEscrowV3.sol";
import {ArcNativeUsdcV3} from "./libraries/ArcNativeUsdcV3.sol";

/// @notice Ownerless, permanent accounting for LP mint rounding residuals.
/// @dev Assets can only be deposited by the bound graduation manager. There is
///      deliberately no transfer, approval, withdrawal, sweep, or forwarding path.
contract PermanentResidualEscrowV3 is IPermanentResidualEscrowV3 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("COOKET_ARC_V1_RESIDUAL");

    address public immutable override launchToken;
    address public immutable override graduationManager;
    address public immutable override settlementExecutor;
    address public constant override canonicalUsdc = ArcNativeUsdcV3.CANONICAL_USDC;
    mapping(address asset => uint256 amount) public override depositedResidual;
    uint256 public override depositedNativeUsdcDust18;

    constructor(address launchToken_, address graduationManager_, address settlementExecutor_) {
        if (
            launchToken_ == address(0) || graduationManager_ == address(0) || settlementExecutor_ == address(0)
                || launchToken_.code.length == 0 || graduationManager_.code.length == 0
                || settlementExecutor_.code.length == 0 || canonicalUsdc.code.length == 0
        ) revert InvalidDependency();
        launchToken = launchToken_;
        graduationManager = graduationManager_;
        settlementExecutor = settlementExecutor_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function deposit(address asset, uint256 amount) external override {
        if (msg.sender != graduationManager) revert UnauthorizedDeposit();
        if (asset != launchToken && asset != canonicalUsdc) revert UnsupportedAsset();
        if (amount == 0) revert ZeroAmount();
        uint256 required = depositedResidual[asset] + amount;
        if (IERC20(asset).balanceOf(address(this)) < required) revert InsufficientBacking();
        depositedResidual[asset] = required;
        emit ResidualDeposited(launchToken, asset, amount);
    }

    function depositNativeUsdcDust() external payable override {
        if (msg.sender != settlementExecutor) revert UnauthorizedDeposit();
        if (msg.value == 0 || msg.value >= ArcNativeUsdcV3.NATIVE_PER_ERC20_BASE_UNIT) {
            revert InvalidNativeUsdcDust();
        }
        depositedNativeUsdcDust18 += msg.value;
        emit NativeUsdcDustDeposited(launchToken, msg.value);
    }
}
