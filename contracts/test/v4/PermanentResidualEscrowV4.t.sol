// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PermanentResidualEscrowV4} from "../../src/v4/PermanentResidualEscrowV4.sol";
import {IPermanentResidualEscrowV4} from "../../src/v4/interfaces/IPermanentResidualEscrowV4.sol";
import {MockArcDualViewUsdcV4} from "./mocks/MockArcDualViewUsdcV4.sol";

contract ResidualTokenV4 is ERC20 {
    constructor() ERC20("Residual", "RSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ResidualDepositAuthorityV4 {
    function deposit(PermanentResidualEscrowV4 escrow, address asset, uint256 amount) external {
        escrow.deposit(asset, amount);
    }
}

contract ResidualDustAuthorityV4 {
    function depositDust(PermanentResidualEscrowV4 escrow) external payable {
        escrow.depositNativeUsdcDust{value: msg.value}();
    }
}

contract PermanentResidualEscrowV4Test is Test {
    address internal creator = makeAddr("residualCreator");
    ResidualDepositAuthorityV4 internal manager;
    ResidualDustAuthorityV4 internal executor;
    MockArcDualViewUsdcV4 internal canonicalUsdc;
    ResidualTokenV4 internal token;
    PermanentResidualEscrowV4 internal escrow;

    function setUp() public {
        MockArcDualViewUsdcV4 usdcImplementation = new MockArcDualViewUsdcV4();
        vm.etch(address(0x8000000000000000000000000000000000000001), address(usdcImplementation).code);
        canonicalUsdc = MockArcDualViewUsdcV4(address(0x8000000000000000000000000000000000000001));
        token = new ResidualTokenV4();
        manager = new ResidualDepositAuthorityV4();
        executor = new ResidualDustAuthorityV4();
        escrow =
            new PermanentResidualEscrowV4(address(token), address(manager), address(executor), address(canonicalUsdc));
        token.mint(address(escrow), 33);
        canonicalUsdc.mint(address(escrow), 1_333);
    }

    function testImmutableDependenciesAndVersion() public view {
        assertEq(escrow.launchToken(), address(token));
        assertEq(escrow.graduationManager(), address(manager));
        assertEq(escrow.canonicalUsdc(), address(canonicalUsdc));
        assertEq(escrow.settlementExecutor(), address(executor));
        assertEq(escrow.protocolVersionHash(), keccak256("endpoint-cp-v4"));
    }

    function testZeroAddressDependenciesReject() public {
        vm.expectRevert(IPermanentResidualEscrowV4.InvalidDependency.selector);
        new PermanentResidualEscrowV4(address(0), address(manager), address(executor), address(canonicalUsdc));
        vm.expectRevert(IPermanentResidualEscrowV4.InvalidDependency.selector);
        new PermanentResidualEscrowV4(address(token), address(0), address(executor), address(canonicalUsdc));
        vm.expectRevert(IPermanentResidualEscrowV4.InvalidDependency.selector);
        new PermanentResidualEscrowV4(address(token), address(manager), address(0), address(canonicalUsdc));
    }

    function testUnauthorizedAndUnsupportedDepositsReject() public {
        vm.expectRevert(IPermanentResidualEscrowV4.UnauthorizedDeposit.selector);
        escrow.deposit(address(token), 1);
        vm.prank(address(manager));
        vm.expectRevert(IPermanentResidualEscrowV4.UnsupportedAsset.selector);
        escrow.deposit(address(0xBEEF), 1);
        vm.prank(address(manager));
        vm.expectRevert(IPermanentResidualEscrowV4.ZeroAmount.selector);
        escrow.deposit(address(token), 0);
    }

    function testAuthorizedTokenAndUsdc6ResidualAccounting() public {
        vm.prank(address(manager));
        escrow.deposit(address(token), 33);
        vm.prank(address(manager));
        escrow.deposit(address(canonicalUsdc), 1_333);
        assertEq(escrow.depositedResidual(address(token)), 33);
        assertEq(escrow.depositedResidual(address(canonicalUsdc)), 1_333);
    }

    function testNativeUsdcDustAccountingIsBoundedAndExecutorOnly() public {
        vm.deal(address(this), 1e12);
        uint256 escrowBalanceBefore = address(escrow).balance;
        vm.expectRevert(IPermanentResidualEscrowV4.UnauthorizedDeposit.selector);
        escrow.depositNativeUsdcDust{value: 1}();
        executor.depositDust{value: 1e12 - 1}(escrow);
        assertEq(escrow.depositedNativeUsdcDust18(), 1e12 - 1);
        assertEq(address(escrow).balance - escrowBalanceBefore, 1e12 - 1);
        vm.deal(address(this), 1e12);
        vm.expectRevert(IPermanentResidualEscrowV4.InvalidNativeUsdcDust.selector);
        executor.depositDust{value: 1e12}(escrow);
    }

    function testInsufficientBackingRejectsAndPreservesAccounting() public {
        vm.prank(address(manager));
        vm.expectRevert(IPermanentResidualEscrowV4.InsufficientBacking.selector);
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
        assertEq(IERC20(address(canonicalUsdc)).balanceOf(address(escrow)), 1_333);
    }
}
