// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcNativeUsdcV3} from "../../src/v3/libraries/ArcNativeUsdcV3.sol";
import {FeeManagerV3} from "../../src/v3/FeeManagerV3.sol";
import {GraduationManagerV3} from "../../src/v3/GraduationManagerV3.sol";
import {CooketFactoryV3} from "../../src/v3/CooketFactoryV3.sol";
import {TokenCommunityVaultV3} from "../../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsVaultV3} from "../../src/v3/TraderRewardsVaultV3.sol";
import {TraderRewardsDistributorV3} from "../../src/v3/TraderRewardsDistributorV3.sol";
import {PermanentLPFeeVaultV3} from "../../src/v3/PermanentLPFeeVaultV3.sol";
import {PermanentLPCustodianDeployerV3} from "../../src/v3/PermanentLPCustodianDeployerV3.sol";
import {MockGraduationManagerV3} from "./mocks/MockGraduationManagerV3.sol";
import {MockUniswapV3FactoryV3} from "./mocks/MockUniswapV3.sol";
import {MockArcDualViewUsdcV3} from "./mocks/MockArcDualViewUsdcV3.sol";
import {MockNonfungiblePositionManagerV3} from "./mocks/MockNonfungiblePositionManagerV3.sol";

contract ArcTestnetDeploymentConfigTest is Test {
    address internal constant CANONICAL_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant SAFE = 0x2741b0E8bC8c90A48CA16cd983a9Ade0dF716d9a;
    address internal constant DEPLOYER = 0x6BE7035f62Ce8ddB4574fE6399eD85E81827c182;
    address internal constant UNISWAP_V3_FACTORY = 0xc70593E016A5d50451b1A2Cf3173E7d77F120B37;
    address internal constant NONFUNGIBLE_POSITION_MANAGER = 0x6f8795B30aB107d6306434d979F50181C0bb68a9;

    function testCanonicalUsdcAndPrecisionArePinned() external pure {
        assertEq(ArcNativeUsdcV3.CANONICAL_USDC, CANONICAL_USDC);
        assertEq(ArcNativeUsdcV3.nativeUsdcToUsdc6Exact(7_245 ether), 7_245_000_000);
        assertEq(ArcNativeUsdcV3.usdc6ToNativeUsdc(1), 1e12);
    }

    function testSafeConfigurationRejectsDeployerAuthority() external pure {
        assertEq(SAFE, 0x2741b0E8bC8c90A48CA16cd983a9Ade0dF716d9a);
        assertTrue(SAFE != DEPLOYER);
        assertEq(UNISWAP_V3_FACTORY, 0xc70593E016A5d50451b1A2Cf3173E7d77F120B37);
        assertEq(NONFUNGIBLE_POSITION_MANAGER, 0x6f8795B30aB107d6306434d979F50181C0bb68a9);
        assertEq(CANONICAL_USDC, 0x3600000000000000000000000000000000000000);
    }

    function testBootstrapConstructorWiring() external {
        MockArcDualViewUsdcV3 implementation = new MockArcDualViewUsdcV3();
        vm.etch(CANONICAL_USDC, address(implementation).code);
        FeeManagerV3 feeManager = new FeeManagerV3(address(this), address(this));
        MockGraduationManagerV3 graduationManager = new MockGraduationManagerV3(address(new MockUniswapV3FactoryV3()));
        CooketFactoryV3 factory = new CooketFactoryV3(address(feeManager), address(graduationManager));
        feeManager.setFactoryOnce(address(factory));
        graduationManager.setFactoryOnce(address(factory));
        TokenCommunityVaultV3 communityVault =
            new TokenCommunityVaultV3(address(this), address(this), address(feeManager));
        TraderRewardsVaultV3 rewardsVault = new TraderRewardsVaultV3(address(this), address(feeManager));
        feeManager.bindEcosystemVaultsOnce(address(communityVault), address(rewardsVault));

        assertEq(address(factory.feeManager()), address(feeManager));
        assertEq(address(factory.graduationManager()), address(graduationManager));
        assertEq(feeManager.factory(), address(factory));
        assertEq(feeManager.communityVault(), address(communityVault));
        assertEq(feeManager.traderRewardsVault(), address(rewardsVault));
    }

    function testGraduationBootstrapAuthoritiesAreSafe() external {
        MockArcDualViewUsdcV3 implementation = new MockArcDualViewUsdcV3();
        vm.etch(CANONICAL_USDC, address(implementation).code);
        GraduationManagerV3 manager = new GraduationManagerV3(address(new MockUniswapV3FactoryV3()), SAFE);

        assertEq(manager.factoryBootstrapAuthority(), SAFE);
        assertEq(manager.dependencyBootstrapAuthority(), SAFE);
        assertTrue(manager.factoryBootstrapAuthority() != DEPLOYER);
        assertTrue(manager.dependencyBootstrapAuthority() != DEPLOYER);
    }

    function testAllPhaseOneBootstrapAuthoritiesAreSafe() external {
        FeeManagerV3 feeManager = new FeeManagerV3(SAFE, SAFE);
        TokenCommunityVaultV3 communityVault = new TokenCommunityVaultV3(SAFE, SAFE, address(feeManager));
        TraderRewardsVaultV3 rewardsVault = new TraderRewardsVaultV3(SAFE, address(feeManager));

        assertEq(feeManager.owner(), SAFE);
        assertEq(feeManager.treasury(), SAFE);
        assertEq(feeManager.factoryBootstrapAuthority(), SAFE);
        assertEq(feeManager.ecosystemBootstrapAuthority(), SAFE);
        assertEq(communityVault.owner(), SAFE);
        assertEq(communityVault.treasury(), SAFE);
        assertEq(communityVault.lpFeeVaultBootstrapAuthority(), SAFE);
        assertEq(rewardsVault.bootstrapAuthority(), SAFE);
        assertTrue(feeManager.owner() != DEPLOYER);
        assertTrue(communityVault.owner() != DEPLOYER);
        assertTrue(rewardsVault.bootstrapAuthority() != DEPLOYER);
    }

    function testFourLegSafeControlledBootstrap() external {
        MockArcDualViewUsdcV3 implementation = new MockArcDualViewUsdcV3();
        vm.etch(CANONICAL_USDC, address(implementation).code);
        MockUniswapV3FactoryV3 uniswapFactory = new MockUniswapV3FactoryV3();
        MockNonfungiblePositionManagerV3 npm = new MockNonfungiblePositionManagerV3(address(uniswapFactory));

        GraduationManagerV3 graduation = new GraduationManagerV3(address(uniswapFactory), SAFE);
        FeeManagerV3 fees = new FeeManagerV3(SAFE, SAFE);
        CooketFactoryV3 factory = new CooketFactoryV3(address(fees), address(graduation));
        TokenCommunityVaultV3 community = new TokenCommunityVaultV3(SAFE, SAFE, address(fees));
        TraderRewardsVaultV3 rewards = new TraderRewardsVaultV3(SAFE, address(fees));
        TraderRewardsDistributorV3 distributor = new TraderRewardsDistributorV3(SAFE, address(rewards));

        vm.startPrank(SAFE);
        fees.setFactoryOnce(address(factory));
        graduation.setFactoryOnce(address(factory));
        fees.bindEcosystemVaultsOnce(address(community), address(rewards));
        rewards.setDistributorOnce(address(distributor));
        vm.stopPrank();

        PermanentLPFeeVaultV3 vault =
            new PermanentLPFeeVaultV3(address(graduation), address(fees), address(community), address(rewards));
        PermanentLPCustodianDeployerV3 custodian =
            new PermanentLPCustodianDeployerV3(address(graduation), address(vault), address(npm));

        vm.startPrank(SAFE);
        community.setPermanentLPFeeVaultOnce(address(vault));
        rewards.setPermanentLPFeeVaultOnce(address(vault));
        graduation.bindDependenciesOnce(address(vault), address(custodian), address(npm));
        vm.stopPrank();

        assertEq(fees.owner(), SAFE);
        assertEq(fees.treasury(), SAFE);
        assertEq(community.owner(), SAFE);
        assertEq(community.treasury(), SAFE);
        assertEq(distributor.owner(), SAFE);
        assertEq(vault.permanentLPCustodianDeployer(), address(custodian));
        assertEq(graduation.settlementExecutor(), custodian.settlementExecutor());
        assertEq(graduation.dependencyBootstrapAuthority(), address(0));
        assertTrue(fees.owner() != DEPLOYER && community.owner() != DEPLOYER && distributor.owner() != DEPLOYER);
    }
}
