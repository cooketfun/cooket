// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PermanentResidualEscrowV3} from "../../src/v3/PermanentResidualEscrowV3.sol";
import {IPermanentResidualEscrowV3} from "../../src/v3/interfaces/IPermanentResidualEscrowV3.sol";
import {ArcNativeUsdcV3} from "../../src/v3/libraries/ArcNativeUsdcV3.sol";
import {MockArcDualViewUsdcV3} from "./mocks/MockArcDualViewUsdcV3.sol";

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

contract ResidualDustAuthorityV3 {
    function depositDust(PermanentResidualEscrowV3 escrow) external payable {
        escrow.depositNativeUsdcDust{value: msg.value}();
    }
}

contract PermanentResidualEscrowV3Test is Test {
    address internal creator = makeAddr("residualCreator");
    ResidualDepositAuthorityV3 internal manager;
    ResidualDustAuthorityV3 internal executor;
    MockArcDualViewUsdcV3 internal canonicalUsdc;
    ResidualTokenV3 internal token;
    PermanentResidualEscrowV3 internal escrow;

    function setUp() public {
        MockArcDualViewUsdcV3 usdcImplementation = new MockArcDualViewUsdcV3();
        vm.etch(ArcNativeUsdcV3.CANONICAL_USDC, address(usdcImplementation).code);
        canonicalUsdc = MockArcDualViewUsdcV3(ArcNativeUsdcV3.CANONICAL_USDC);
        token = new ResidualTokenV3();
        manager = new ResidualDepositAuthorityV3();
        executor = new ResidualDustAuthorityV3();
        escrow = new PermanentResidualEscrowV3(address(token), address(manager), address(executor));
        token.mint(address(escrow), 33);
        canonicalUsdc.mint(address(escrow), 1_333);
    }

    function testImmutableDependenciesAndVersion() public view {
        assertEq(escrow.launchToken(), address(token));
        assertEq(escrow.graduationManager(), address(manager));
        assertEq(escrow.canonicalUsdc(), address(canonicalUsdc));
        assertEq(escrow.settlementExecutor(), address(executor));
        assertEq(escrow.protocolVersionHash(), keccak256("COOKET_ARC_V1_RESIDUAL"));
    }

    function testZeroAddressDependenciesReject() public {
        vm.expectRevert(IPermanentResidualEscrowV3.InvalidDependency.selector);
        new PermanentResidualEscrowV3(address(0), address(manager), address(executor));
        vm.expectRevert(IPermanentResidualEscrowV3.InvalidDependency.selector);
        new PermanentResidualEscrowV3(address(token), address(0), address(executor));
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
        vm.expectRevert(IPermanentResidualEscrowV3.UnauthorizedDeposit.selector);
        escrow.depositNativeUsdcDust{value: 1}();
        executor.depositDust{value: 1e12 - 1}(escrow);
        assertEq(escrow.depositedNativeUsdcDust18(), 1e12 - 1);
        assertEq(address(escrow).balance - escrowBalanceBefore, 1e12 - 1);
        vm.deal(address(this), 1e12);
        vm.expectRevert(IPermanentResidualEscrowV3.InvalidNativeUsdcDust.selector);
        executor.depositDust{value: 1e12}(escrow);
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
        assertEq(IERC20(address(canonicalUsdc)).balanceOf(address(escrow)), 1_333);
    }
}
