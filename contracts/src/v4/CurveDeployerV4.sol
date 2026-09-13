// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICurveDeployerV4} from "./interfaces/ICurveDeployerV4.sol";
import {CooketCurveV4} from "./CooketCurveV4.sol";

/// @notice Immutable endpoint-cp-v4 curve child deployer.
contract CurveDeployerV4 is ICurveDeployerV4 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v4");

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
        curve = address(new CooketCurveV4(factory, token, creator, feeManager, graduationManager));
    }
}
