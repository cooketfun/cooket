// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICurveDeployerV3 {
    error UnauthorizedFactory();

    function deployCurve(address token, address creator) external returns (address curve);
    function factory() external view returns (address);
    function feeManager() external view returns (address);
    function graduationManager() external view returns (address);
    function protocolVersionHash() external pure returns (bytes32);
}
