// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICooketCurveV3} from "../../src/v3/interfaces/ICooketCurveV3.sol";
import {CooketV3TestBase} from "./helpers/CooketV3TestBase.sol";

contract ForceEtherCurveV3 {
    constructor() payable {}

    function force(address payable to) external {
        selfdestruct(to);
    }
}

contract CooketCurveV3Test is CooketV3TestBase {
    function testForcedEthDoesNotChangeQuotesOrGraduationAccounting() public {
        ICooketCurveV3.BuyQuote memory beforeQuote = curve.quoteBuy(GRADUATION_GROSS);
        ForceEtherCurveV3 force = new ForceEtherCurveV3{value: 2 ether}();
        force.force(payable(address(curve)));
        ICooketCurveV3.BuyQuote memory afterQuote = curve.quoteBuy(GRADUATION_GROSS);
        assertEq(keccak256(abi.encode(beforeQuote)), keccak256(abi.encode(afterQuote)));
        assertEq(curve.unaccountedEth(), 2 ether);
        vm.prank(buyer);
        curve.buy{value: afterQuote.acceptedGross}(afterQuote.tokensOut, block.timestamp);
        assertTrue(curve.graduated());
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.graduationEthForwarded(), 3 ether);
        assertEq(address(curve).balance, 2 ether);
        assertEq(curve.unaccountedEth(), 2 ether);
    }

    function testCanonicalConstantsAndInitialEndpoint() public view {
        assertEq(curve.PROTOCOL_VERSION(), "endpoint-cp-v3");
        assertEq(curve.feePolicyHash(), keccak256("cooket-fee-design-b-v3"));
        assertEq(curve.TOTAL_SUPPLY(), 1_000_000_000 ether);
        assertEq(curve.CURVE_ALLOCATION(), 800_000_000 ether);
        assertEq(curve.LP_ALLOCATION(), 200_000_000 ether);
        assertEq(curve.VIRTUAL_TOKEN_RESERVE(), 1_066_666_666_666_666_666_666_666_667);
        assertEq(curve.VIRTUAL_ETH_RESERVE(), 1 ether);
        assertEq(curve.GRADUATION_RESERVE(), 3 ether);
        assertEq(curve.EXACT_GRADUATION_GROSS(), GRADUATION_GROSS);
        assertEq(curve.spotPrice(), 937_500_000);
        assertEq(curve.spotPrice() * 1_000_000_000, 0.9375 ether);
    }

    function testGrossRequiredForNetMatchesCanonicalVectors() public view {
        assertEq(curve.grossRequiredForNet(1), 1);
        assertEq(curve.grossRequiredForNet(99), 99);
        assertEq(curve.grossRequiredForNet(100), 101);
        assertEq(curve.grossRequiredForNet(3 ether), GRADUATION_GROSS);
        for (uint256 net = 1; net < 10_000; ++net) {
            uint256 gross = curve.grossRequiredForNet(net);
            assertEq(gross - gross / 100, net);
            assertLt((gross - 1) - ((gross - 1) / 100), net);
        }
    }

    function testGrossRequiredForNetRejectsUnrepresentableGrossWithoutOverflowPanic() public {
        vm.expectRevert(ICooketCurveV3.InvalidAmount.selector);
        curve.grossRequiredForNet(type(uint256).max);
    }

    function testAcceptedSimulatorBuyVector() public {
        ICooketCurveV3.BuyQuote memory quote = curve.quoteBuy(0.1 ether);
        assertEq(quote.totalFee, 1_000_000_000_000_000);
        assertEq(quote.creatorFee, 350_000_000_000_000);
        assertEq(quote.protocolFee, 300_000_000_000_000);
        assertEq(quote.communityFee, 200_000_000_000_000);
        assertEq(quote.traderRewardsFee, 150_000_000_000_000);
        assertEq(quote.netCurveInput, 99_000_000_000_000_000);
        assertEq(quote.tokensOut, 96_087_352_138_307_552_320_291_173);

        vm.prank(buyer);
        ICooketCurveV3.BuyQuote memory executed = curve.buy{value: 0.1 ether}(quote.tokensOut, block.timestamp);
        assertEq(keccak256(abi.encode(executed)), keccak256(abi.encode(quote)));
        assertEq(feeManager.totalLiabilities(), quote.totalFee);
        assertEq(feeManager.creatorFeesAccrued(address(token)), quote.creatorFee);
        assertEq(feeManager.protocolFeesAccrued(), quote.protocolFee);
        assertEq(feeManager.communityFeesAccrued(), quote.communityFee);
        assertEq(feeManager.traderRewardsFeesAccrued(), quote.traderRewardsFee);
        assertEq(curve.activeEthReserve(), 99_000_000_000_000_000);
        assertEq(curve.spotPrice(), 1_132_313_438);
    }

    function testDifferentialAcceptedLaunchVectors() public view {
        uint256[9] memory grossInputs = [
            uint256(10_000_000_000_000),
            100_000_000_000_000,
            1_000_000_000_000_000,
            10_000_000_000_000_000,
            50_000_000_000_000_000,
            100_000_000_000_000_000,
            250_000_000_000_000_000,
            500_000_000_000_000_000,
            1_000_000_000_000_000_000
        ];
        uint256[9] memory expectedTokens = [
            uint256(10_559_895_457_034_975_353_743),
            105_589_546_634_883_146_568_489,
            1_054_955_593_961_977_642_134_287,
            10_456_480_839_687_097_732_448_757,
            50_309_671_272_034_302_048_594_568,
            96_087_352_138_307_552_320_291_173,
            211_623_246_492_985_971_943_887_775,
            353_177_257_525_083_612_040_133_779,
            530_653_266_331_658_291_457_286_432
        ];
        for (uint256 i; i < grossInputs.length; ++i) {
            ICooketCurveV3.BuyQuote memory quote = curve.quoteBuy(grossInputs[i]);
            assertEq(quote.acceptedGross, grossInputs[i]);
            assertEq(quote.netCurveInput, grossInputs[i] - grossInputs[i] / 100);
            assertEq(quote.tokensOut, expectedTokens[i]);
        }
    }

    function testOneWeiBelowExactAndOneWeiAboveGraduationBoundary() public {
        ICooketCurveV3.BuyQuote memory belowQuote = curve.quoteBuy(GRADUATION_GROSS - 1);
        assertFalse(belowQuote.reachesGraduation);
        assertEq(belowQuote.refund, 0);
        assertEq(belowQuote.netCurveInput, 3 ether - 1);

        vm.prank(buyer);
        curve.buy{value: GRADUATION_GROSS - 1}(belowQuote.tokensOut, block.timestamp);
        assertFalse(curve.graduated());
        assertEq(curve.activeEthReserve(), 3 ether - 1);

        ICooketCurveV3.BuyQuote memory lastWei = curve.quoteBuy(1);
        assertTrue(lastWei.reachesGraduation);
        assertEq(lastWei.acceptedGross, 1);
        assertEq(lastWei.refund, 0);
        vm.prank(buyer);
        curve.buy{value: 1}(lastWei.tokensOut, block.timestamp);
        assertTrue(curve.graduated());
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.soldSupply(), CURVE_ALLOCATION);
        assertEq(curve.spotPrice(), 15_000_000_000);
    }

    function testExactBoundaryGraduatesAndForwardsPrincipal() public {
        vm.prank(buyer);
        ICooketCurveV3.BuyQuote memory quote = curve.buy{value: GRADUATION_GROSS}(0, block.timestamp);
        assertTrue(quote.reachesGraduation);
        assertEq(quote.refund, 0);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.graduationEthForwarded(), 3 ether);
        assertEq(curve.soldSupply(), CURVE_ALLOCATION);
        assertEq(token.balanceOf(buyer), CURVE_ALLOCATION);
        assertEq(token.balanceOf(address(graduationManager)), LP_ALLOCATION);
        assertEq(address(graduationManager).balance, 3 ether);
        assertEq(address(curve).balance, 0);
        assertEq(graduationManager.calls(), 1);
        assertEq(graduationManager.lastCreator(), creator);
    }

    function testOneWeiAboveBoundaryRefundsAndFeesOnlyAcceptedGross() public {
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        ICooketCurveV3.BuyQuote memory quote = curve.buy{value: GRADUATION_GROSS + 1}(0, block.timestamp);
        assertEq(quote.acceptedGross, GRADUATION_GROSS);
        assertEq(quote.refund, 1);
        assertEq(buyerBefore - buyer.balance, GRADUATION_GROSS);
        assertEq(feeManager.totalLiabilities(), quote.totalFee);
        assertEq(feeManager.creatorFeesAccrued(address(token)), quote.creatorFee);
        assertEq(feeManager.protocolFeesAccrued(), quote.protocolFee);
        assertEq(feeManager.communityFeesAccrued(), quote.communityFee);
        assertEq(feeManager.traderRewardsFeesAccrued(), quote.traderRewardsFee);
    }

    function testTinyFeeWeiAlwaysBelongsToProtocolRemainderSink() public {
        ICooketCurveV3.FeeSplit memory split = curve.splitFee(100);
        assertEq(split.totalFee, 1);
        assertEq(split.creatorFee, 0);
        assertEq(split.protocolFee, 1);
        assertEq(split.communityFee, 0);
        assertEq(split.traderRewardsFee, 0);
        vm.prank(buyer);
        curve.buy{value: 100}(0, block.timestamp);
        assertEq(feeManager.protocolFeesAccrued(), 1);
        assertEq(feeManager.creatorFeesAccrued(address(token)), 0);
        assertEq(feeManager.totalLiabilities(), 1);
        assertEq(curve.activeEthReserve(), 99);
    }

    function testFeeDesignBExactAllocationAndProtocolRemainder() public view {
        ICooketCurveV3.FeeSplit memory exactSplit = curve.splitFee(10_000);
        assertEq(exactSplit.totalFee, 100);
        assertEq(exactSplit.creatorFee, 35);
        assertEq(exactSplit.protocolFee, 30);
        assertEq(exactSplit.communityFee, 20);
        assertEq(exactSplit.traderRewardsFee, 15);

        ICooketCurveV3.FeeSplit memory roundedSplit = curve.splitFee(10_100);
        assertEq(roundedSplit.totalFee, 101);
        assertEq(roundedSplit.creatorFee, 35);
        assertEq(roundedSplit.communityFee, 20);
        assertEq(roundedSplit.traderRewardsFee, 15);
        assertEq(roundedSplit.protocolFee, 31);
    }

    function testFuzzFeeSplitIsOnePercentAndFullyAllocated(uint256 grossAmount) public view {
        grossAmount = bound(grossAmount, 0, type(uint256).max / 100);
        ICooketCurveV3.FeeSplit memory split = curve.splitFee(grossAmount);
        assertEq(split.totalFee, grossAmount / 100);
        assertEq(split.creatorFee, split.totalFee * 35 / 100);
        assertEq(split.communityFee, split.totalFee * 20 / 100);
        assertEq(split.traderRewardsFee, split.totalFee * 15 / 100);
        assertEq(split.creatorFee + split.protocolFee + split.communityFee + split.traderRewardsFee, split.totalFee);
    }

    function testBuyAndSellQuoteExecutionParityAndRoundTripAccounting() public {
        ICooketCurveV3.BuyQuote memory buyQuote = curve.quoteBuy(1 ether);
        vm.prank(buyer);
        ICooketCurveV3.BuyQuote memory buyExecution = curve.buy{value: 1 ether}(buyQuote.tokensOut, block.timestamp);
        assertEq(keccak256(abi.encode(buyQuote)), keccak256(abi.encode(buyExecution)));

        vm.prank(buyer);
        token.approve(address(curve), buyQuote.tokensOut);
        ICooketCurveV3.SellQuote memory sellQuote = curve.quoteSell(buyQuote.tokensOut);
        vm.prank(buyer);
        ICooketCurveV3.SellQuote memory sellExecution =
            curve.sell(buyQuote.tokensOut, sellQuote.netSellerOutput, block.timestamp);
        assertEq(keccak256(abi.encode(sellQuote)), keccak256(abi.encode(sellExecution)));
        assertEq(feeManager.totalLiabilities(), buyQuote.totalFee + sellQuote.totalFee);
        assertEq(feeManager.creatorFeesAccrued(address(token)), buyQuote.creatorFee + sellQuote.creatorFee);
        assertEq(feeManager.protocolFeesAccrued(), buyQuote.protocolFee + sellQuote.protocolFee);
        assertEq(feeManager.communityFeesAccrued(), buyQuote.communityFee + sellQuote.communityFee);
        assertEq(feeManager.traderRewardsFeesAccrued(), buyQuote.traderRewardsFee + sellQuote.traderRewardsFee);
        assertEq(sellQuote.grossCurveOutput, buyQuote.netCurveInput);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.soldSupply(), 0);
        assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY);
    }

    function testTokenAndEthConservationDuringBuyAndSell() public {
        uint256 gross = 0.5 ether;
        uint256 buyerEthBefore = buyer.balance;
        uint256 tokensOut = _buy(buyer, curve, gross);
        assertEq(token.balanceOf(address(curve)) + token.balanceOf(buyer), TOTAL_SUPPLY);
        assertEq(address(curve).balance + address(feeManager).balance + buyer.balance, buyerEthBefore);

        vm.startPrank(buyer);
        token.approve(address(curve), tokensOut);
        curve.sell(tokensOut, 0, block.timestamp);
        vm.stopPrank();
        assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY);
        assertEq(curve.activeEthReserve(), 0);
        assertEq(address(curve).balance, 0);
    }

    function testReservedInventoryCannotBePurchasedOrWithdrawn() public {
        vm.prank(buyer);
        curve.buy{value: GRADUATION_GROSS}(0, block.timestamp);
        assertEq(token.balanceOf(buyer), CURVE_ALLOCATION);
        assertEq(token.balanceOf(address(graduationManager)), LP_ALLOCATION);
        assertEq(token.balanceOf(creator), 0);
        assertEq(token.balanceOf(address(factory)), 0);
        (bool success,) = address(curve).call(abi.encodeWithSignature("withdraw(address,uint256)", creator, 1));
        assertFalse(success);
    }

    function testTradingAfterGraduationAndSecondGraduationPathReject() public {
        vm.prank(buyer);
        curve.buy{value: GRADUATION_GROSS}(0, block.timestamp);
        vm.expectRevert(ICooketCurveV3.TradingClosed.selector);
        curve.quoteBuy(1);
        vm.expectRevert(ICooketCurveV3.TradingClosed.selector);
        curve.quoteSell(1);
        assertEq(graduationManager.calls(), 1);
    }

    function testCompetingFinalGraduationBuysPreserveExactReserve() public {
        address rival = makeAddr("rivalBuyer");
        vm.deal(rival, 10 ether);
        ICooketCurveV3.BuyQuote memory firstQuote = curve.quoteBuy(GRADUATION_GROSS);
        ICooketCurveV3.BuyQuote memory staleSecondQuote = firstQuote;

        vm.prank(buyer);
        curve.buy{value: firstQuote.acceptedGross}(firstQuote.tokensOut, block.timestamp);
        assertTrue(curve.graduated());
        assertEq(curve.activeEthReserve(), 0);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.graduationEthForwarded(), 3 ether);
        assertEq(address(graduationManager).balance, 3 ether);
        assertEq(graduationManager.calls(), 1);

        vm.prank(rival);
        vm.expectRevert(ICooketCurveV3.TradingClosed.selector);
        curve.buy{value: staleSecondQuote.acceptedGross}(staleSecondQuote.tokensOut, block.timestamp);
        assertEq(curve.terminalGraduationReserve(), 3 ether);
        assertEq(curve.graduationEthForwarded(), 3 ether);
        assertEq(address(graduationManager).balance, 3 ether);
        assertEq(graduationManager.calls(), 1);
        assertEq(token.balanceOf(rival), 0);
    }

    function testStrictMinOutRevertsAfterAdversarialStateMovement() public {
        ICooketCurveV3.BuyQuote memory victimQuote = curve.quoteBuy(0.1 ether);
        address attacker = makeAddr("mevAttacker");
        vm.deal(attacker, 10 ether);
        _buy(attacker, curve, 0.5 ether);

        vm.prank(buyer);
        vm.expectRevert(ICooketCurveV3.SlippageExceeded.selector);
        curve.buy{value: 0.1 ether}(victimQuote.tokensOut, block.timestamp);
        assertEq(token.balanceOf(buyer), 0);
    }

    function testLooseMinOutMayExecuteAtWorsePrice() public {
        ICooketCurveV3.BuyQuote memory original = curve.quoteBuy(0.1 ether);
        address attacker = makeAddr("looseSlippageAttacker");
        vm.deal(attacker, 10 ether);
        _buy(attacker, curve, 0.5 ether);

        ICooketCurveV3.BuyQuote memory moved = curve.quoteBuy(0.1 ether);
        assertLt(moved.tokensOut, original.tokensOut);

        vm.prank(buyer);
        ICooketCurveV3.BuyQuote memory executed = curve.buy{value: 0.1 ether}(0, block.timestamp);
        assertEq(executed.tokensOut, moved.tokensOut);
        assertLt(executed.tokensOut, original.tokensOut);
        assertEq(token.balanceOf(buyer), executed.tokensOut);
    }

    function testDeadlineSlippageZeroAndDustProtection() public {
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(ICooketCurveV3.InvalidAmount.selector);
        curve.buy{value: 0}(0, block.timestamp);

        ICooketCurveV3.BuyQuote memory quote = curve.quoteBuy(0.01 ether);
        vm.prank(buyer);
        vm.expectRevert(ICooketCurveV3.SlippageExceeded.selector);
        curve.buy{value: 0.01 ether}(quote.tokensOut + 1, block.timestamp);
        vm.prank(buyer);
        vm.expectRevert(ICooketCurveV3.DeadlineExpired.selector);
        curve.buy{value: 0.01 ether}(0, block.timestamp - 1);

        _buy(buyer, curve, 0.01 ether);
        vm.expectRevert(ICooketCurveV3.DustTrade.selector);
        curve.quoteSell(1);
    }

    function testSellDeadlineAndSlippageProtection() public {
        uint256 tokensOut = _buy(buyer, curve, 0.1 ether);
        ICooketCurveV3.SellQuote memory quote = curve.quoteSell(tokensOut);
        vm.startPrank(buyer);
        token.approve(address(curve), tokensOut);
        vm.expectRevert(ICooketCurveV3.SlippageExceeded.selector);
        curve.sell(tokensOut, quote.netSellerOutput + 1, block.timestamp);
        vm.expectRevert(ICooketCurveV3.DeadlineExpired.selector);
        curve.sell(tokensOut, 0, block.timestamp - 1);
        vm.stopPrank();
        assertEq(curve.soldSupply(), tokensOut);
        assertEq(token.balanceOf(buyer), tokensOut);
    }

    function testFuzzBuyQuoteExecutionParity(uint96 rawGross) public {
        uint256 gross = bound(uint256(rawGross), 1, 2 ether);
        ICooketCurveV3.BuyQuote memory quote = curve.quoteBuy(gross);
        vm.prank(buyer);
        ICooketCurveV3.BuyQuote memory execution = curve.buy{value: gross}(quote.tokensOut, block.timestamp);
        assertEq(keccak256(abi.encode(quote)), keccak256(abi.encode(execution)));
        assertLe(curve.soldSupply(), CURVE_ALLOCATION);
        assertLe(curve.activeEthReserve(), 3 ether);
        assertGe(curve.virtualTokenReserve() * curve.virtualEthReserve(), curve.K());
    }

    function testFuzzSellQuoteExecutionParity(uint96 rawGross, uint256 rawTokens) public {
        uint256 gross = bound(uint256(rawGross), 0.01 ether, 1 ether);
        uint256 purchased = _buy(buyer, curve, gross);
        uint256 tokensIn = bound(rawTokens, 2_000_000_000, purchased);
        ICooketCurveV3.SellQuote memory quote = curve.quoteSell(tokensIn);
        vm.startPrank(buyer);
        token.approve(address(curve), tokensIn);
        ICooketCurveV3.SellQuote memory execution = curve.sell(tokensIn, quote.netSellerOutput, block.timestamp);
        vm.stopPrank();
        assertEq(keccak256(abi.encode(quote)), keccak256(abi.encode(execution)));
        assertLe(quote.grossCurveOutput, gross);
        assertGe(curve.virtualTokenReserve() * curve.virtualEthReserve(), curve.K());
    }
}

contract CooketTokenV3Test is CooketV3TestBase {
    function testFixedSupplySingleMintAndZeroCreatorAllocation() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY);
        assertEq(token.balanceOf(creator), 0);
        assertEq(token.creator(), creator);
    }

    function testNoMintOrInventoryAdminSurface() public {
        (bool mintSuccess,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", creator, 1));
        (bool seizeSuccess,) = address(token).call(abi.encodeWithSignature("seize(address,uint256)", creator, 1));
        assertFalse(mintSuccess);
        assertFalse(seizeSuccess);
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
    }
}
