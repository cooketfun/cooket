// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGraduationManagerV3} from "./interfaces/IGraduationManagerV3.sol";
import {INonfungiblePositionManagerV3} from "./interfaces/INonfungiblePositionManagerV3.sol";
import {IPermanentLPCustodianDeployerV3} from "./interfaces/IPermanentLPCustodianDeployerV3.sol";
import {IPermanentLPFeeVaultV3} from "./interfaces/IPermanentLPFeeVaultV3.sol";
import {PermanentLPCustodianV3} from "./PermanentLPCustodianV3.sol";
import {GraduationSettlementExecutorV3} from "./GraduationSettlementExecutorV3.sol";
import {ArcNativeUsdcV3} from "./libraries/ArcNativeUsdcV3.sol";

/// @notice Immutable one-custodian-per-launch deployment boundary for Stage 2B.2.
contract PermanentLPCustodianDeployerV3 is IPermanentLPCustodianDeployerV3 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("COOKET_ARC_V1_CUSTODY");

    address public immutable graduationManager;
    address public immutable factory;
    address public immutable feeVault;
    address public constant canonicalUsdc = ArcNativeUsdcV3.CANONICAL_USDC;
    address public immutable nonfungiblePositionManager;
    address public immutable override settlementExecutor;
    mapping(address launchToken => address custodian) public custodianOf;

    constructor(address graduationManager_, address feeVault_, address nonfungiblePositionManager_) {
        if (
            graduationManager_ == address(0) || graduationManager_.code.length == 0 || feeVault_ == address(0)
                || feeVault_.code.length == 0 || nonfungiblePositionManager_ == address(0)
                || nonfungiblePositionManager_.code.length == 0
        ) revert InvalidDependency();
        IGraduationManagerV3 manager = IGraduationManagerV3(graduationManager_);
        if (
            canonicalUsdc.code.length == 0 || manager.factory() == address(0)
                || manager.canonicalUsdc() != canonicalUsdc
                || manager.protocolVersionHash() != keccak256("endpoint-cp-v3")
                || IPermanentLPFeeVaultV3(feeVault_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || IPermanentLPFeeVaultV3(feeVault_).factory() != manager.factory()
                || IPermanentLPFeeVaultV3(feeVault_).graduationManager() != graduationManager_
                || IPermanentLPFeeVaultV3(feeVault_).canonicalUsdc() != canonicalUsdc
                || INonfungiblePositionManagerV3(nonfungiblePositionManager_).factory() != manager.uniswapV3Factory()
        ) revert InvalidDependency();
        graduationManager = graduationManager_;
        factory = manager.factory();
        feeVault = feeVault_;
        nonfungiblePositionManager = nonfungiblePositionManager_;
        settlementExecutor =
            address(new GraduationSettlementExecutorV3(graduationManager_, nonfungiblePositionManager_));
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function deployCustodian(address launchToken) external override returns (address custodian) {
        if (msg.sender != graduationManager) revert UnauthorizedGraduationManager();
        if (launchToken == address(0) || launchToken.code.length == 0) revert InvalidLaunchToken();
        if (custodianOf[launchToken] != address(0)) revert CustodianAlreadyDeployed();
        custodian =
            address(new PermanentLPCustodianV3(launchToken, nonfungiblePositionManager, graduationManager, feeVault));
        custodianOf[launchToken] = custodian;
        emit PermanentCustodianDeployed(launchToken, custodian);
    }
}
