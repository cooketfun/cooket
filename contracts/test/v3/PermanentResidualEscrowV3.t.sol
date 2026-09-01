// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PermanentResidualEscrowV3} from "../../src/v3/PermanentResidualEscrowV3.sol";
import {IPermanentResidualEscrowV3} from "../../src/v3/interfaces/IPermanentResidualEscrowV3.sol";
import {MockWETHV3} from "./mocks/MockUniswapV3.sol";

contract ResidualTokenV3 is ERC20 {
    constructor() ERC20("Residual", "RSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ResidualDepositAuthorityV3 {
    function deposit(PermanentResidualEscrowV3 escrow, address asset, uint256 amount) external {
        escrow.deposit(asset, amount);
    }
}

contract PermanentResidualEscrowV3Test is Test {
    address internal creator = makeAddr("residualCreator");
    ResidualDepositAuthorityV3 internal manager;
    MockWETHV3 internal weth;
    ResidualTokenV3 internal token;
    PermanentResidualEscrowV3 internal escrow;

    function setUp() public {
        weth = new MockWETHV3();
        token = new ResidualTokenV3();
        manager = new ResidualDepositAuthorityV3();
        escrow = new PermanentResidualEscrowV3(address(token), address(manager), address(weth));
        token.mint(address(escrow), 33);
        weth.mint(address(escrow), 1_333);
    }

    function testImmutableDependenciesAndVersion() public view {
        assertEq(escrow.launchToken(), address(token));
        assertEq(escrow.graduationManager(), address(manager));
        assertEq(escrow.weth(), address(weth));
        assertEq(escrow.protocolVersionHash(), keccak256("endpoint-cp-v3-residual-2b1"));
    }

    function testZeroAddressDependenciesReject() public {
        vm.expectRevert(IPermanentResidualEscrowV3.InvalidDependency.selector);
        new PermanentResidualEscrowV3(address(0), address(manager), address(weth));
        vm.expectRevert(IPermanentResidualEscrowV3.InvalidDependency.selector);
        new PermanentResidualEscrowV3(address(token), address(0), address(weth));
        vm.expectRevert(IPermanentResidualEscrowV3.InvalidDependency.selector);
        new PermanentResidualEscrowV3(address(token), address(manager), address(0));
    }

    function testUnauthorizedAndUnsupportedDepositsReject() public {
        vm.expectRevert(IPermanentResidualEscrowV3.UnauthorizedDeposit.selector);
        escrow.deposit(address(token), 1);
        vm.prank(address(manager));
        vm.expectRevert(IPermanentResidualEscrowV3.UnsupportedAsset.selector);
        escrow.deposit(address(0xBEEF), 1);
        vm.prank(address(manager));
        vm.expectRevert(IPermanentResidualEscrowV3.ZeroAmount.selector);
        escrow.deposit(address(token), 0);
    }

    function testAuthorizedTokenAndWethResidualAccounting() public {
        vm.prank(address(manager));
        escrow.deposit(address(token), 33);
        vm.prank(address(manager));
        escrow.deposit(address(weth), 1_333);
        assertEq(escrow.depositedResidual(address(token)), 33);
        assertEq(escrow.depositedResidual(address(weth)), 1_333);
    }

    function testInsufficientBackingRejectsAndPreservesAccounting() public {
        vm.prank(address(manager));
        vm.expectRevert(IPermanentResidualEscrowV3.InsufficientBacking.selector);
        escrow.deposit(address(token), 34);
        assertEq(escrow.depositedResidual(address(token)), 0);
    }

    function testNoWithdrawalSweepApprovalOrForwardingSurface() public {
        bytes memory withdrawal = abi.encodeWithSignature("withdraw(address,uint256)", address(token), 1);
        (bool ok,) = address(escrow).call(withdrawal);
        assertFalse(ok);
        (ok,) = address(escrow).call(abi.encodeWithSignature("sweep(address)", address(token)));
        assertFalse(ok);
        (ok,) = address(escrow).call(abi.encodeWithSignature("approve(address,uint256)", address(manager), 1));
        assertFalse(ok);
        assertEq(IERC20(address(token)).balanceOf(address(escrow)), 33);
        assertEq(IERC20(address(weth)).balanceOf(address(escrow)), 1_333);
    }
}
