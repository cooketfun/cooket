// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICooketCurveV3} from "../../src/v3/interfaces/ICooketCurveV3.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {CooketCurveV3} from "../../src/v3/CooketCurveV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";

contract ReentrantTraderV3 {
    enum Attack {
        None,
        Buy,
        Sell
    }

    CooketCurveV3 public immutable curve;
    IERC20 public immutable token;
    Attack public attack;
    bool public reentrySucceeded;

    constructor(CooketCurveV3 curve_, IERC20 token_) {
        curve = curve_;
        token = token_;
    }

    function boundaryBuy() external payable {
        attack = Attack.Buy;
        curve.buy{value: msg.value}(0, block.timestamp);
        attack = Attack.None;
    }

    function sellAll() external {
        attack = Attack.Sell;
        uint256 balance = token.balanceOf(address(this));
        token.approve(address(curve), balance);
        curve.sell(balance, 0, block.timestamp);
        attack = Attack.None;
    }

    receive() external payable {
        if (attack == Attack.Buy) {
            (reentrySucceeded,) = address(curve).call{value: 1}(abi.encodeCall(CooketCurveV3.buy, (0, block.timestamp)));
        } else if (attack == Attack.Sell) {
            (reentrySucceeded,) = address(curve).call(abi.encodeCall(CooketCurveV3.sell, (1, 0, block.timestamp)));
        }
    }
}

contract ReentrantFeeRecipientV3 {
    FeeManagerV3 public manager;
    address public token;
    bool public protocolClaim;
    bool public reentrySucceeded;

    function configure(FeeManagerV3 manager_, address token_, bool protocolClaim_) external {
        manager = manager_;
        token = token_;
        protocolClaim = protocolClaim_;
    }

    function acceptCreator() external {
        manager.acceptCreatorPayout(token);
    }

    function acceptTreasury() external {
        manager.acceptTreasury();
    }

    receive() external payable {
        bytes memory data = protocolClaim
            ? abi.encodeCall(FeeManagerV3.claimProtocolFees, ())
            : abi.encodeCall(FeeManagerV3.claimCreatorFees, (token));
        (reentrySucceeded,) = address(manager).call(data);
    }
}

contract CooketV3SecurityTest is CooketV3TestBase {
    function testGraduationCallbackFailureRevertsCompleteFinalBuy() public {
        graduationManager.configure(true, address(0), "");
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        vm.expectRevert(bytes("GRADUATION_FAILED"));
        curve.buy{value: GRADUATION_GROSS + 1 ether}(0, block.timestamp);

        assertEq(buyer.balance, buyerBefore);
        assertEq(curve.soldSupply(), 0);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 0);
        assertFalse(curve.graduated());
        assertEq(curve.graduationEthForwarded(), 0);
        assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY);
        assertEq(token.balanceOf(buyer), 0);
        assertEq(token.balanceOf(address(graduationManager)), 0);
        assertEq(address(graduationManager).balance, 0);
        assertEq(feeManager.protocolFeesAccrued(), 0);
        assertEq(feeManager.creatorFeesAccrued(address(token)), 0);
        assertEq(feeManager.communityFeesAccrued(), 0);
        assertEq(feeManager.traderRewardsFeesAccrued(), 0);
        assertEq(feeManager.totalLiabilities(), 0);
    }

    function testGraduationCallbackCannotReenterBuy() public {
        bytes memory data = abi.encodeCall(CooketCurveV3.buy, (0, block.timestamp));
        graduationManager.configure(false, address(curve), data);
        vm.prank(buyer);
        curve.buy{value: GRADUATION_GROSS}(0, block.timestamp);
        assertFalse(graduationManager.reentrySucceeded());
        assertEq(graduationManager.calls(), 1);
        assertTrue(curve.graduated());
    }

    function testRefundCallbackCannotReenterBuy() public {
        ReentrantTraderV3 attacker = new ReentrantTraderV3(curve, token);
        attacker.boundaryBuy{value: GRADUATION_GROSS + 1 ether}();
        assertFalse(attacker.reentrySucceeded());
        assertTrue(curve.graduated());
        assertEq(address(attacker).balance, 1 ether);
        assertEq(token.balanceOf(address(attacker)), CURVE_ALLOCATION);
    }

    function testSellPayoutCallbackCannotReenterSell() public {
        ReentrantTraderV3 attacker = new ReentrantTraderV3(curve, token);
        uint256 tokensOut = _buy(buyer, curve, 0.1 ether);
        vm.prank(buyer);
        assertTrue(token.transfer(address(attacker), tokensOut));
        attacker.sellAll();
        assertFalse(attacker.reentrySucceeded());
        assertEq(curve.soldSupply(), 0);
        assertEq(curve.activeEthReserve(), 0);
    }

    function testCreatorFeeClaimCallbackCannotReenterClaim() public {
        ReentrantFeeRecipientV3 receiver = new ReentrantFeeRecipientV3();
        receiver.configure(feeManager, address(token), false);
        vm.prank(creator);
        feeManager.proposeCreatorPayout(address(token), address(receiver));
        receiver.acceptCreator();
        _buy(buyer, curve, 0.1 ether);
        feeManager.claimCreatorFees(address(token));
        assertFalse(receiver.reentrySucceeded());
        assertEq(feeManager.creatorFeesAccrued(address(token)), 0);
    }

    function testProtocolFeeClaimCallbackCannotReenterClaim() public {
        ReentrantFeeRecipientV3 receiver = new ReentrantFeeRecipientV3();
        receiver.configure(feeManager, address(token), true);
        feeManager.proposeTreasury(address(receiver));
        vm.warp(block.timestamp + 48 hours);
        receiver.acceptTreasury();
        _buy(buyer, curve, 0.1 ether);
        feeManager.claimProtocolFees();
        assertFalse(receiver.reentrySucceeded());
        assertEq(feeManager.protocolFeesAccrued(), 0);
    }

    function testRejectingRefundRevertsEntireBuy() public {
        RefundRejectorV3 rejector = new RefundRejectorV3(curve);
        vm.expectRevert(ICooketCurveV3.NativeTransferFailed.selector);
        rejector.buyWithExcess{value: GRADUATION_GROSS + 1 ether}();
        assertEq(curve.soldSupply(), 0);
        assertEq(curve.activeEthReserve(), 0);
        assertFalse(curve.graduated());
        assertEq(graduationManager.calls(), 0);
        assertEq(feeManager.protocolFeesAccrued(), 0);
        assertEq(feeManager.totalLiabilities(), 0);
    }
}

contract RefundRejectorV3 {
    CooketCurveV3 public immutable curve;

    constructor(CooketCurveV3 curve_) {
        curve = curve_;
    }

    function buyWithExcess() external payable {
        curve.buy{value: msg.value}(0, block.timestamp);
    }

    receive() external payable {
        revert("NO_REFUND");
    }
}
