// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FeeManagerV3} from "../../../src/v3/FeeManagerV3.sol";
import {PermanentLPFeeVaultV3} from "../../../src/v3/PermanentLPFeeVaultV3.sol";
import {TokenCommunityVaultV3} from "../../../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsDistributorV3} from "../../../src/v3/TraderRewardsDistributorV3.sol";
import {TraderRewardsVaultV3} from "../../../src/v3/TraderRewardsVaultV3.sol";
import {CooketCurveV3} from "../../../src/v3/CooketCurveV3.sol";
import {CooketFactoryV3} from "../../../src/v3/CooketFactoryV3.sol";
import {CooketTokenV3} from "../../../src/v3/CooketTokenV3.sol";
import {MockGraduationManagerV3} from "../mocks/MockGraduationManagerV3.sol";
import {MockUniswapV3FactoryV3} from "../mocks/MockUniswapV3.sol";
import {MockArcDualViewUsdcV3} from "../mocks/MockArcDualViewUsdcV3.sol";
import {ArcNativeUsdcV3} from "../../../src/v3/libraries/ArcNativeUsdcV3.sol";

abstract contract CooketV3TestBase is Test {
    uint256 internal constant TOKEN_UNIT = 1e18;
    uint256 internal constant NATIVE_USDC_UNIT = 1e18;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 * TOKEN_UNIT;
    uint256 internal constant CURVE_ALLOCATION = 800_000_000 * TOKEN_UNIT;
    uint256 internal constant LP_ALLOCATION = 200_000_000 * TOKEN_UNIT;
    uint256 internal constant GRADUATION_NATIVE_USDC_RESERVE = 7_245 * NATIVE_USDC_UNIT;
    uint256 internal constant GRADUATION_GROSS = 7_318_181_818_181_818_181_818;

    address internal creator = makeAddr("v3Creator");
    address internal buyer = makeAddr("v3Buyer");
    address internal treasury = makeAddr("v3Treasury");

    FeeManagerV3 internal feeManager;
    PermanentLPFeeVaultV3 internal lpFeeVault;
    TokenCommunityVaultV3 internal communityVault;
    TraderRewardsVaultV3 internal rewardsVault;
    TraderRewardsDistributorV3 internal rewardsDistributor;
    MockGraduationManagerV3 internal graduationManager;
    MockUniswapV3FactoryV3 internal uniswapFactory;
    MockArcDualViewUsdcV3 internal canonicalUsdc;
    CooketFactoryV3 internal factory;
    CooketTokenV3 internal token;
    CooketCurveV3 internal curve;

    function setUp() public virtual {
        feeManager = new FeeManagerV3(address(this), treasury);
        MockArcDualViewUsdcV3 usdcImplementation = new MockArcDualViewUsdcV3();
        vm.etch(ArcNativeUsdcV3.CANONICAL_USDC, address(usdcImplementation).code);
        canonicalUsdc = MockArcDualViewUsdcV3(ArcNativeUsdcV3.CANONICAL_USDC);
        uniswapFactory = new MockUniswapV3FactoryV3();
        graduationManager = new MockGraduationManagerV3(address(uniswapFactory));
        factory = new CooketFactoryV3(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        communityVault = new TokenCommunityVaultV3(address(this), treasury, address(feeManager));
        rewardsVault = new TraderRewardsVaultV3(address(this), address(feeManager));
        rewardsDistributor = new TraderRewardsDistributorV3(address(this), address(rewardsVault));
        rewardsVault.setDistributorOnce(address(rewardsDistributor));
        feeManager.bindEcosystemVaultsOnce(address(communityVault), address(rewardsVault));
        lpFeeVault = new PermanentLPFeeVaultV3(
            address(graduationManager), address(feeManager), address(communityVault), address(rewardsVault)
        );
        communityVault.setPermanentLPFeeVaultOnce(address(lpFeeVault));
        rewardsVault.setPermanentLPFeeVaultOnce(address(lpFeeVault));
        (token, curve) = _launch(creator, "Endpoint Cooket", "EPZ");
        vm.deal(buyer, 10_000 * NATIVE_USDC_UNIT);
    }

    function _launch(address launchCreator, string memory name, string memory symbol)
        internal
        returns (CooketTokenV3 launchedToken, CooketCurveV3 launchedCurve)
    {
        vm.prank(launchCreator);
        bytes32 userSalt = keccak256(abi.encode(launchCreator, name, symbol));
        (address tokenAddress, address curveAddress) = factory.createToken(name, symbol, userSalt);
        launchedToken = CooketTokenV3(tokenAddress);
        launchedCurve = CooketCurveV3(payable(curveAddress));
    }

    function _buy(address account, CooketCurveV3 targetCurve, uint256 gross) internal returns (uint256 tokensOut) {
        CooketCurveV3.BuyQuote memory quote = targetCurve.quoteBuy(gross);
        vm.prank(account);
        CooketCurveV3.BuyQuote memory executed =
            targetCurve.buy{value: gross}(quote.tokensOut, block.timestamp + 1 hours);
        return executed.tokensOut;
    }
}
