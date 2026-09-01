// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICurveDeployerV3} from "./interfaces/ICurveDeployerV3.sol";
import {CooketCurveV3} from "./CooketCurveV3.sol";

/// @notice Immutable endpoint-cp-v3 curve child deployer.
contract CurveDeployerV3 is ICurveDeployerV3 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");

    address public immutable override factory;
    address public immutable override feeManager;
    address public immutable override graduationManager;

    constructor(address feeManager_, address graduationManager_) {
        factory = msg.sender;
        feeManager = feeManager_;
        graduationManager = graduationManager_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function deployCurve(address token, address creator) external override returns (address curve) {
        if (msg.sender != factory) revert UnauthorizedFactory();
        curve = address(new CooketCurveV3(factory, token, creator, feeManager, graduationManager));
    }
}
