// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGraduationManagerV4} from "./interfaces/IGraduationManagerV4.sol";
import {INonfungiblePositionManagerV3} from "../v3/interfaces/INonfungiblePositionManagerV3.sol";
import {IPermanentLPCustodianDeployerV4} from "./interfaces/IPermanentLPCustodianDeployerV4.sol";
import {IPermanentLPFeeVaultV4} from "./interfaces/IPermanentLPFeeVaultV4.sol";
import {PermanentLPCustodianV4} from "./PermanentLPCustodianV4.sol";
import {GraduationSettlementExecutorV4} from "./GraduationSettlementExecutorV4.sol";

/// @notice Immutable one-custodian-per-launch deployment boundary for Stage 2B.2.
contract PermanentLPCustodianDeployerV4 is IPermanentLPCustodianDeployerV4 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v4");

    address public immutable graduationManager;
    address public immutable factory;
    address public immutable feeVault;
    address public immutable canonicalUsdc;
    address public immutable nonfungiblePositionManager;
    address public immutable override settlementExecutor;
    mapping(address launchToken => address custodian) public custodianOf;

    constructor(address graduationManager_, address feeVault_, address nonfungiblePositionManager_) {
        if (
            graduationManager_ == address(0) || graduationManager_.code.length == 0 || feeVault_ == address(0)
                || feeVault_.code.length == 0 || nonfungiblePositionManager_ == address(0)
                || nonfungiblePositionManager_.code.length == 0
        ) revert InvalidDependency();
        IGraduationManagerV4 manager = IGraduationManagerV4(graduationManager_);
        address canonicalUsdc_ = manager.canonicalUsdc();
        if (
            canonicalUsdc_ == address(0) || canonicalUsdc_.code.length == 0 || manager.factory() == address(0)
                || manager.protocolVersionHash() != keccak256("endpoint-cp-v4")
                || IPermanentLPFeeVaultV4(feeVault_).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || IPermanentLPFeeVaultV4(feeVault_).factory() != manager.factory()
                || IPermanentLPFeeVaultV4(feeVault_).graduationManager() != graduationManager_
                || IPermanentLPFeeVaultV4(feeVault_).canonicalUsdc() != canonicalUsdc_
                || INonfungiblePositionManagerV3(nonfungiblePositionManager_).factory() != manager.uniswapV3Factory()
        ) revert InvalidDependency();
        canonicalUsdc = canonicalUsdc_;
        graduationManager = graduationManager_;
        factory = manager.factory();
        feeVault = feeVault_;
        nonfungiblePositionManager = nonfungiblePositionManager_;
        settlementExecutor =
            address(new GraduationSettlementExecutorV4(graduationManager_, nonfungiblePositionManager_));
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function deployCustodian(address launchToken) external override returns (address custodian) {
        if (msg.sender != graduationManager) revert UnauthorizedGraduationManager();
        if (launchToken == address(0) || launchToken.code.length == 0) revert InvalidLaunchToken();
        if (custodianOf[launchToken] != address(0)) revert CustodianAlreadyDeployed();
        custodian =
            address(new PermanentLPCustodianV4(launchToken, nonfungiblePositionManager, graduationManager, feeVault));
        custodianOf[launchToken] = custodian;
        emit PermanentCustodianDeployed(launchToken, custodian);
    }
}
