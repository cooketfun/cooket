// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {FeeManagerV3} from "../src/v3/FeeManagerV3.sol";
import {GraduationManagerV3} from "../src/v3/GraduationManagerV3.sol";
import {CooketFactoryV3} from "../src/v3/CooketFactoryV3.sol";
import {TokenCommunityVaultV3} from "../src/v3/TokenCommunityVaultV3.sol";
import {TraderRewardsVaultV3} from "../src/v3/TraderRewardsVaultV3.sol";
import {TraderRewardsDistributorV3} from "../src/v3/TraderRewardsDistributorV3.sol";
import {PermanentLPFeeVaultV3} from "../src/v3/PermanentLPFeeVaultV3.sol";
import {PermanentLPCustodianDeployerV3} from "../src/v3/PermanentLPCustodianDeployerV3.sol";

contract DeployCooketArcTestnet is Script {
    string internal constant DIR = "deployments/arc-testnet";
    string internal constant PROBE = "deployments/arc-testnet/.manifest-write-probe.json";
    string internal constant CORE_PENDING = "deployments/arc-testnet/core.pending.json";
    string internal constant LP_PENDING = "deployments/arc-testnet/lp.pending.json";
    address internal constant SAFE = 0x2741b0E8bC8c90A48CA16cd983a9Ade0dF716d9a;
    address internal constant DEPLOYER = 0x6BE7035f62Ce8ddB4574fE6399eD85E81827c182;
    address internal constant UNISWAP_FACTORY = 0xc70593E016A5d50451b1A2Cf3173E7d77F120B37;
    address internal constant POSITION_MANAGER = 0x6f8795B30aB107d6306434d979F50181C0bb68a9;
    address internal constant CANONICAL_USDC = 0x3600000000000000000000000000000000000000;

    function core(bool writeManifest) external {
        _baseChecks();
        if (writeManifest) _probeWrite();
        vm.startBroadcast();
        GraduationManagerV3 graduation = new GraduationManagerV3(UNISWAP_FACTORY, SAFE);
        FeeManagerV3 fees = new FeeManagerV3(SAFE, SAFE);
        CooketFactoryV3 factory = new CooketFactoryV3(address(fees), address(graduation));
        TokenCommunityVaultV3 community = new TokenCommunityVaultV3(SAFE, SAFE, address(fees));
        TraderRewardsVaultV3 rewards = new TraderRewardsVaultV3(SAFE, address(fees));
        TraderRewardsDistributorV3 distributor = new TraderRewardsDistributorV3(SAFE, address(rewards));
        vm.stopBroadcast();
        if (writeManifest) _writeCore(graduation, fees, factory, community, rewards, distributor);
    }

    function lp(
        address graduation,
        address fees,
        address factory,
        address community,
        address rewards,
        bool writeManifest
    ) external {
        _baseChecks();
        require(FeeManagerV3(payable(fees)).factory() == factory, "Stage 1: fee factory");
        require(GraduationManagerV3(graduation).factory() == factory, "Stage 1: graduation factory");
        require(FeeManagerV3(payable(fees)).communityVault() == community, "Stage 1: community");
        require(FeeManagerV3(payable(fees)).traderRewardsVault() == rewards, "Stage 1: rewards");
        if (writeManifest) _probeWrite();
        vm.startBroadcast();
        PermanentLPFeeVaultV3 vault = new PermanentLPFeeVaultV3(graduation, fees, community, rewards);
        PermanentLPCustodianDeployerV3 custodian =
            new PermanentLPCustodianDeployerV3(graduation, address(vault), POSITION_MANAGER);
        vm.stopBroadcast();
        if (writeManifest) {
            string memory key = "lp";
            string memory json = vm.serializeAddress(key, "permanentLPFeeVault", address(vault));
            json = vm.serializeAddress(key, "permanentLPCustodianDeployer", address(custodian));
            json = vm.serializeAddress(key, "graduationSettlementExecutor", custodian.settlementExecutor());
            json = vm.serializeString(key, "bootstrapStatus", "pending-stage2");
            vm.writeJson(json, LP_PENDING);
        }
    }

    function _baseChecks() private view {
        require(block.chainid == 5042002, "Arc Testnet only");
        require(SAFE != DEPLOYER, "unsafe authority");
        require(UNISWAP_FACTORY.code.length != 0, "missing V3 factory");
        require(POSITION_MANAGER.code.length != 0, "missing NPM");
        require(CANONICAL_USDC.code.length != 0, "missing USDC");
    }

    function _probeWrite() private {
        vm.createDir(DIR, true);
        vm.writeJson('{"ok":true}', PROBE);
        vm.removeFile(PROBE);
    }

    function _writeCore(
        GraduationManagerV3 graduation,
        FeeManagerV3 fees,
        CooketFactoryV3 factory,
        TokenCommunityVaultV3 community,
        TraderRewardsVaultV3 rewards,
        TraderRewardsDistributorV3 distributor
    ) private {
        string memory key = "core";
        string memory json = vm.serializeUint(key, "chainId", 5042002);
        json = vm.serializeAddress(key, "safe", SAFE);
        json = vm.serializeAddress(key, "deployer", DEPLOYER);
        json = vm.serializeAddress(key, "canonicalUsdc", CANONICAL_USDC);
        json = vm.serializeAddress(key, "uniswapV3Factory", UNISWAP_FACTORY);
        json = vm.serializeAddress(key, "nonfungiblePositionManager", POSITION_MANAGER);
        json = vm.serializeAddress(key, "graduationManager", address(graduation));
        json = vm.serializeAddress(key, "feeManager", address(fees));
        json = vm.serializeAddress(key, "ctoRegistry", fees.ctoRegistry());
        json = vm.serializeAddress(key, "cooketFactory", address(factory));
        json = vm.serializeAddress(key, "tokenDeployer", factory.tokenDeployer());
        json = vm.serializeAddress(key, "curveDeployer", factory.curveDeployer());
        json = vm.serializeAddress(key, "communityVault", address(community));
        json = vm.serializeAddress(key, "rewardsVault", address(rewards));
        json = vm.serializeAddress(key, "rewardsDistributor", address(distributor));
        json = vm.serializeString(key, "bootstrapStatus", "pending-stage1");
        vm.writeJson(json, CORE_PENDING);
    }
}
