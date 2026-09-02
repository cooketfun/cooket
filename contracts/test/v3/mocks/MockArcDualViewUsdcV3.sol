// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Test-only model of Arc's linked native-18/ERC20-USDC-6 balance views.
/// @dev Foundry's deal cheatcode models the native debit/credit caused by the
/// canonical precompile. This proves local accounting logic, not Arc runtime conformance.
contract MockArcDualViewUsdcV3 is IERC20 {
    uint256 private constant SCALE = 1e12;
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    mapping(address owner => mapping(address spender => uint256 amount)) private _allowance;
    mapping(address account => bool blocked) public blocked;
    bool public revertTransfers;

    function name() external pure returns (string memory) {
        return "Arc USDC";
    }

    function symbol() external pure returns (string memory) {
        return "USDC";
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function totalSupply() external pure returns (uint256) {
        return type(uint256).max;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return account.balance / SCALE;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowance[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = _allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "INSUFFICIENT_ALLOWANCE");
            _allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowed - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount6) external {
        require(to != address(0), "ZERO_RECIPIENT");
        uint256 nativeAmount = amount6 * SCALE;
        VM.deal(to, to.balance + nativeAmount);
        emit Transfer(address(0), to, amount6);
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function setRevertTransfers(bool value) external {
        revertTransfers = value;
    }

    function _transfer(address from, address to, uint256 amount6) private {
        require(!revertTransfers, "USDC_TRANSFER_REVERTED");
        require(to != address(0), "ZERO_RECIPIENT");
        require(!blocked[from] && !blocked[to], "BLOCKLISTED");
        uint256 nativeAmount = amount6 * SCALE;
        require(from.balance >= nativeAmount, "INSUFFICIENT_BALANCE");
        VM.deal(from, from.balance - nativeAmount);
        VM.deal(to, to.balance + nativeAmount);
        emit Transfer(from, to, amount6);
    }
}
