// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FeeManagerV4} from "../../src/v4/FeeManagerV4.sol";
import {CooketCurveV4} from "../../src/v4/CooketCurveV4.sol";
import {CooketFactoryV4} from "../../src/v4/CooketFactoryV4.sol";
import {CooketTokenV4} from "../../src/v4/CooketTokenV4.sol";
import {TokenCommunityVaultV4} from "../../src/v4/TokenCommunityVaultV4.sol";
import {TraderRewardsDistributorV4} from "../../src/v4/TraderRewardsDistributorV4.sol";
import {TraderRewardsVaultV4} from "../../src/v4/TraderRewardsVaultV4.sol";
import {MockGraduationManagerV4} from "./mocks/MockGraduationManagerV4.sol";
import {MockUniswapV3FactoryV4} from "./mocks/MockUniswapV3V4.sol";
import {MockArcDualViewUsdcV4} from "./mocks/MockArcDualViewUsdcV4.sol";

contract CurveHandlerV4 {
    CooketCurveV4 public immutable curve;
    CooketTokenV4 public immutable token;
    FeeManagerV4 public immutable feeManager;

    constructor(CooketCurveV4 curve_, CooketTokenV4 token_, FeeManagerV4 feeManager_) payable {
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

    function claimCreator() external {
        try feeManager.claimCreatorFees(address(token)) {} catch {}
    }

    function claimProtocol() external {
        try feeManager.claimProtocolFees() {} catch {}
    }

    receive() external payable {}
}

contract CooketCurveV4InvariantTest is Test {
    uint256 private constant TOKEN_UNIT = 1e18;
    uint256 private constant NATIVE_USDC_UNIT = 1e18;
    uint256 private constant TOTAL_SUPPLY = 1_000_000_000 * TOKEN_UNIT;
    uint256 private constant CURVE_ALLOCATION = 800_000_000 * TOKEN_UNIT;
    uint256 private constant LP_ALLOCATION = 200_000_000 * TOKEN_UNIT;
    uint256 private constant GRADUATION_NATIVE_USDC_RESERVE = 14_490 * NATIVE_USDC_UNIT;

    FeeManagerV4 private feeManager;
    MockGraduationManagerV4 private graduationManager;
    CooketFactoryV4 private factory;
    CooketTokenV4 private token;
    CooketCurveV4 private curve;
    CurveHandlerV4 private handler;
    TokenCommunityVaultV4 private communityVault;
    TraderRewardsVaultV4 private rewardsVault;

    function setUp() public {
        feeManager = new FeeManagerV4(address(this), makeAddr("invariantTreasury"));
        MockArcDualViewUsdcV4 usdcImplementation = new MockArcDualViewUsdcV4();
        vm.etch(address(0x8000000000000000000000000000000000000001), address(usdcImplementation).code);
        MockUniswapV3FactoryV4 uniswapFactory = new MockUniswapV3FactoryV4();
        graduationManager =
            new MockGraduationManagerV4(address(uniswapFactory), address(0x8000000000000000000000000000000000000001));
        factory = new CooketFactoryV4(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        communityVault =
            new TokenCommunityVaultV4(address(this), makeAddr("invariantCommunityTreasury"), address(feeManager));
        rewardsVault = new TraderRewardsVaultV4(address(this), address(feeManager));
        TraderRewardsDistributorV4 distributor = new TraderRewardsDistributorV4(address(this), address(rewardsVault));
        rewardsVault.setDistributorOnce(address(distributor));
        feeManager.bindEcosystemVaultsOnce(address(communityVault), address(rewardsVault));
        (address tokenAddress, address curveAddress) =
            factory.createToken("Invariant V4", "IV4", keccak256("invariant-salt"));
        token = CooketTokenV4(tokenAddress);
        curve = CooketCurveV4(payable(curveAddress));
        handler = new CurveHandlerV4{value: 20_000 * NATIVE_USDC_UNIT}(curve, token, feeManager);
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
        assertLe(curve.activeNativeUsdcReserve(), GRADUATION_NATIVE_USDC_RESERVE);
        assertEq(address(curve).balance, curve.activeNativeUsdcReserve());
        assertEq(curve.reserveCoordinate(), curve.activeNativeUsdcReserve() + curve.terminalGraduationReserve());
        assertEq(address(feeManager).balance, feeManager.totalLiabilities());
        assertEq(address(communityVault).balance, communityVault.totalAccrued(address(0)));
        assertEq(address(rewardsVault).balance, rewardsVault.totalAccrued(address(0)));
        assertEq(
            feeManager.totalLiabilities(),
            feeManager.protocolFeesAccrued() + feeManager.totalCreatorFeesAccrued() + feeManager.communityFeesAccrued()
                + feeManager.traderRewardsFeesAccrued()
        );
        assertGe(curve.virtualTokenReserve() * curve.virtualNativeUsdcReserve(), curve.K());
    }

    function invariantGraduationOccursAtMostOnceAndOnlyAtEndpoint() public view {
        assertLe(graduationManager.calls(), 1);
        if (curve.graduated()) {
            assertEq(curve.soldSupply(), CURVE_ALLOCATION);
            assertEq(curve.activeNativeUsdcReserve(), 0);
            assertEq(curve.terminalGraduationReserve(), GRADUATION_NATIVE_USDC_RESERVE);
            assertEq(curve.graduationNativeUsdcForwarded(), GRADUATION_NATIVE_USDC_RESERVE);
            assertEq(graduationManager.calls(), 1);
        }
    }
}
