// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {CooketCurveV3} from "../../src/v3/CooketCurveV3.sol";
import {CooketFactoryV3} from "../../src/v3/CooketFactoryV3.sol";
import {CooketTokenV3} from "../../src/v3/CooketTokenV3.sol";
import {TokenCommunityVaultV3} from "../../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsDistributorV3} from "../../src/v3/TraderRewardsDistributorV3.sol";
import {TraderRewardsVaultV3} from "../../src/v3/TraderRewardsVaultV3.sol";
import {MockGraduationManagerV3} from "./mocks/MockGraduationManagerV3.sol";
import {MockUniswapV3FactoryV3, MockWETHV3} from "./mocks/MockUniswapV3.sol";

contract CurveHandlerV3 {
    CooketCurveV3 public immutable curve;
    CooketTokenV3 public immutable token;
    FeeManagerV3 public immutable feeManager;

    constructor(CooketCurveV3 curve_, CooketTokenV3 token_, FeeManagerV3 feeManager_) payable {
        curve = curve_;
        token = token_;
        feeManager = feeManager_;
        token_.approve(address(curve_), type(uint256).max);
    }

    function buy(uint96 seed) external {
        if (curve.graduated()) return;
        uint256 gross = 1 + (uint256(seed) % 0.05 ether);
        if (address(this).balance < gross) return;
        try curve.buy{value: gross}(0, block.timestamp) {} catch {}
    }

    function sell(uint256 seed) external {
        if (curve.graduated()) return;
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = 1 + (seed % balance);
        try curve.sell(amount, 0, block.timestamp) {} catch {}
    }

    function fundCommunity() external {
        try feeManager.fundCommunityVault(address(token)) {} catch {}
    }

    function fundRewards() external {
        try feeManager.fundTraderRewardsVault(address(token)) {} catch {}
    }

    receive() external payable {}
}

contract CooketCurveV3InvariantTest is Test {
    uint256 private constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 private constant CURVE_ALLOCATION = 800_000_000 ether;
    uint256 private constant LP_ALLOCATION = 200_000_000 ether;

    FeeManagerV3 private feeManager;
    MockGraduationManagerV3 private graduationManager;
    CooketFactoryV3 private factory;
    CooketTokenV3 private token;
    CooketCurveV3 private curve;
    CurveHandlerV3 private handler;
    TokenCommunityVaultV3 private communityVault;
    TraderRewardsVaultV3 private rewardsVault;

    function setUp() public {
        feeManager = new FeeManagerV3(address(this), makeAddr("invariantTreasury"));
        MockUniswapV3FactoryV3 uniswapFactory = new MockUniswapV3FactoryV3();
        MockWETHV3 weth = new MockWETHV3();
        graduationManager = new MockGraduationManagerV3(address(uniswapFactory), address(weth));
        factory = new CooketFactoryV3(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        communityVault =
            new TokenCommunityVaultV3(address(this), makeAddr("invariantCommunityTreasury"), address(feeManager));
        rewardsVault = new TraderRewardsVaultV3(address(this), address(feeManager));
        TraderRewardsDistributorV3 distributor = new TraderRewardsDistributorV3(address(this), address(rewardsVault));
        rewardsVault.setDistributorOnce(address(distributor));
        feeManager.bindEcosystemVaultsOnce(address(communityVault), address(rewardsVault));
        (address tokenAddress, address curveAddress) =
            factory.createToken("Invariant V3", "IV3", keccak256("invariant-salt"));
        token = CooketTokenV3(tokenAddress);
        curve = CooketCurveV3(payable(curveAddress));
        handler = new CurveHandlerV3{value: 100 ether}(curve, token, feeManager);
        targetContract(address(handler));
    }

    function invariantTokenSupplyAndAllocationAreConserved() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertLe(curve.soldSupply(), CURVE_ALLOCATION);
        assertEq(
            token.balanceOf(address(curve)) + token.balanceOf(address(handler))
                + token.balanceOf(address(graduationManager)),
            TOTAL_SUPPLY
        );
        if (curve.graduated()) {
            assertEq(token.balanceOf(address(handler)), CURVE_ALLOCATION);
            assertEq(token.balanceOf(address(graduationManager)), LP_ALLOCATION);
        } else {
            assertEq(token.balanceOf(address(curve)), TOTAL_SUPPLY - curve.soldSupply());
        }
    }

    function invariantReserveAndFeeLiabilitiesAreFullyBacked() public view {
        assertLe(curve.activeEthReserve(), 3 ether);
        assertEq(address(curve).balance, curve.activeEthReserve());
        assertEq(curve.reserveCoordinate(), curve.activeEthReserve() + curve.terminalGraduationReserve());
        assertEq(address(feeManager).balance, feeManager.totalLiabilities());
        assertEq(address(communityVault).balance, communityVault.totalAccrued(address(0)));
        assertEq(address(rewardsVault).balance, rewardsVault.totalAccrued(address(0)));
        assertEq(
            feeManager.totalLiabilities(),
            feeManager.protocolFeesAccrued() + feeManager.totalCreatorFeesAccrued() + feeManager.communityFeesAccrued()
                + feeManager.traderRewardsFeesAccrued()
        );
        assertGe(curve.virtualTokenReserve() * curve.virtualEthReserve(), curve.K());
    }

    function invariantGraduationOccursAtMostOnceAndOnlyAtEndpoint() public view {
        assertLe(graduationManager.calls(), 1);
        if (curve.graduated()) {
            assertEq(curve.soldSupply(), CURVE_ALLOCATION);
            assertEq(curve.activeEthReserve(), 0);
            assertEq(curve.terminalGraduationReserve(), 3 ether);
            assertEq(curve.graduationEthForwarded(), 3 ether);
            assertEq(graduationManager.calls(), 1);
        }
    }
}
