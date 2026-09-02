// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPermanentLPCustodianDeployerV3 {
    error CustodianAlreadyDeployed();
    error InvalidDependency();
    error InvalidLaunchToken();
    error UnauthorizedGraduationManager();

    event PermanentCustodianDeployed(address indexed launchToken, address indexed custodian);

    function deployCustodian(address launchToken) external returns (address custodian);
    function protocolVersionHash() external pure returns (bytes32);
    function graduationManager() external view returns (address);
    function factory() external view returns (address);
    function feeVault() external view returns (address);
    function canonicalUsdc() external view returns (address);
    function nonfungiblePositionManager() external view returns (address);
    function settlementExecutor() external view returns (address);
    function custodianOf(address launchToken) external view returns (address);
}
