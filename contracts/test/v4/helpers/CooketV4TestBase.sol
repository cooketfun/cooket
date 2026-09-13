// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FeeManagerV4} from "../../../src/v4/FeeManagerV4.sol";
import {PermanentLPFeeVaultV4} from "../../../src/v4/PermanentLPFeeVaultV4.sol";
import {TokenCommunityVaultV4} from "../../../src/v4/TokenCommunityVaultV4.sol";
import {TraderRewardsDistributorV4} from "../../../src/v4/TraderRewardsDistributorV4.sol";
import {TraderRewardsVaultV4} from "../../../src/v4/TraderRewardsVaultV4.sol";
import {CooketCurveV4} from "../../../src/v4/CooketCurveV4.sol";
import {CooketFactoryV4} from "../../../src/v4/CooketFactoryV4.sol";
import {CooketTokenV4} from "../../../src/v4/CooketTokenV4.sol";
import {MockGraduationManagerV4} from "../mocks/MockGraduationManagerV4.sol";
import {MockUniswapV3FactoryV4} from "../mocks/MockUniswapV3V4.sol";
import {MockArcDualViewUsdcV4} from "../mocks/MockArcDualViewUsdcV4.sol";

abstract contract CooketV4TestBase is Test {
    uint256 internal constant TOKEN_UNIT = 1e18;
    uint256 internal constant NATIVE_USDC_UNIT = 1e18;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 * TOKEN_UNIT;
    uint256 internal constant CURVE_ALLOCATION = 800_000_000 * TOKEN_UNIT;
    uint256 internal constant LP_ALLOCATION = 200_000_000 * TOKEN_UNIT;
    uint256 internal constant GRADUATION_NATIVE_USDC_RESERVE = 14_490 * NATIVE_USDC_UNIT;
    uint256 internal constant GRADUATION_GROSS = 14_636_363_636_363_636_363_636;

    address internal creator = makeAddr("v4Creator");
    address internal buyer = makeAddr("v4Buyer");
    address internal treasury = makeAddr("v4Treasury");

    FeeManagerV4 internal feeManager;
    PermanentLPFeeVaultV4 internal lpFeeVault;
    TokenCommunityVaultV4 internal communityVault;
    TraderRewardsVaultV4 internal rewardsVault;
    TraderRewardsDistributorV4 internal rewardsDistributor;
    MockGraduationManagerV4 internal graduationManager;
    MockUniswapV3FactoryV4 internal uniswapFactory;
    MockArcDualViewUsdcV4 internal canonicalUsdc;
    CooketFactoryV4 internal factory;
    CooketTokenV4 internal token;
    CooketCurveV4 internal curve;

    function setUp() public virtual {
        feeManager = new FeeManagerV4(address(this), treasury);
        MockArcDualViewUsdcV4 usdcImplementation = new MockArcDualViewUsdcV4();
        vm.etch(address(0x8000000000000000000000000000000000000001), address(usdcImplementation).code);
        canonicalUsdc = MockArcDualViewUsdcV4(address(0x8000000000000000000000000000000000000001));
        uniswapFactory = new MockUniswapV3FactoryV4();
        graduationManager = new MockGraduationManagerV4(address(uniswapFactory), address(canonicalUsdc));
        factory = new CooketFactoryV4(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        communityVault = new TokenCommunityVaultV4(address(this), treasury, address(feeManager));
        rewardsVault = new TraderRewardsVaultV4(address(this), address(feeManager));
        rewardsDistributor = new TraderRewardsDistributorV4(address(this), address(rewardsVault));
        rewardsVault.setDistributorOnce(address(rewardsDistributor));
        feeManager.bindEcosystemVaultsOnce(address(communityVault), address(rewardsVault));
        lpFeeVault = new PermanentLPFeeVaultV4(
            address(graduationManager),
            address(feeManager),
            address(communityVault),
            address(rewardsVault),
            address(canonicalUsdc)
        );
        communityVault.setPermanentLPFeeVaultOnce(address(lpFeeVault));
        rewardsVault.setPermanentLPFeeVaultOnce(address(lpFeeVault));
        (token, curve) = _launch(creator, "Endpoint Cooket", "EPZ");
        vm.deal(buyer, 20_000 * NATIVE_USDC_UNIT);
    }

    function _launch(address launchCreator, string memory name, string memory symbol)
        internal
        returns (CooketTokenV4 launchedToken, CooketCurveV4 launchedCurve)
    {
        vm.prank(launchCreator);
        bytes32 userSalt = keccak256(abi.encode(launchCreator, name, symbol));
        (address tokenAddress, address curveAddress) = factory.createToken(name, symbol, userSalt);
        launchedToken = CooketTokenV4(tokenAddress);
        launchedCurve = CooketCurveV4(payable(curveAddress));
    }

    function _buy(address account, CooketCurveV4 targetCurve, uint256 gross) internal returns (uint256 tokensOut) {
        CooketCurveV4.BuyQuote memory quote = targetCurve.quoteBuy(gross);
        vm.prank(account);
        CooketCurveV4.BuyQuote memory executed =
            targetCurve.buy{value: gross}(quote.tokensOut, block.timestamp + 1 hours);
        return executed.tokensOut;
    }
}
