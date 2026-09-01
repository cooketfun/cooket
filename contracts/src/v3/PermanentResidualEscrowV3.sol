// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPermanentResidualEscrowV3} from "./interfaces/IPermanentResidualEscrowV3.sol";

/// @notice Ownerless, permanent accounting for LP mint rounding residuals.
/// @dev Assets can only be deposited by the bound graduation manager. There is
///      deliberately no transfer, approval, withdrawal, sweep, or forwarding path.
contract PermanentResidualEscrowV3 is IPermanentResidualEscrowV3 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3-residual-2b1");

    address public immutable override launchToken;
    address public immutable override graduationManager;
    address public immutable override weth;
    mapping(address asset => uint256 amount) public override depositedResidual;

    constructor(address launchToken_, address graduationManager_, address weth_) {
        if (
            launchToken_ == address(0) || graduationManager_ == address(0) || weth_ == address(0)
                || launchToken_.code.length == 0 || graduationManager_.code.length == 0 || weth_.code.length == 0
        ) revert InvalidDependency();
        launchToken = launchToken_;
        graduationManager = graduationManager_;
        weth = weth_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function deposit(address asset, uint256 amount) external override {
        if (msg.sender != graduationManager) revert UnauthorizedDeposit();
        if (asset != launchToken && asset != weth) revert UnsupportedAsset();
        if (amount == 0) revert ZeroAmount();
        uint256 required = depositedResidual[asset] + amount;
        if (IERC20(asset).balanceOf(address(this)) < required) revert InsufficientBacking();
        depositedResidual[asset] = required;
        emit ResidualDeposited(launchToken, asset, amount);
    }
}
