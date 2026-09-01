// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EndpointConstantsV3} from "./libraries/EndpointConstantsV3.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {IGraduationManagerV3} from "./interfaces/IGraduationManagerV3.sol";
import {ICooketFactoryV3} from "./interfaces/ICooketFactoryV3.sol";
import {ICurveDeployerV3} from "./interfaces/ICurveDeployerV3.sol";
import {ITokenDeployerV3} from "./interfaces/ITokenDeployerV3.sol";
import {CurveDeployerV3} from "./CurveDeployerV3.sol";
import {TokenDeployerV3} from "./TokenDeployerV3.sol";
import {CooketTokenV3} from "./CooketTokenV3.sol";

/// @notice Atomic launcher and registry for the separate endpoint-cp-v3 family.
contract CooketFactoryV3 is ICooketFactoryV3 {
    string public constant PROTOCOL_VERSION = "endpoint-cp-v3";
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v3");
    uint256 public constant TOTAL_SUPPLY = EndpointConstantsV3.TOTAL_SUPPLY;
    uint256 public constant CURVE_ALLOCATION = EndpointConstantsV3.CURVE_ALLOCATION;
    uint256 public constant LP_ALLOCATION = EndpointConstantsV3.LP_ALLOCATION;

    IFeeManagerV3 public immutable feeManager;
    IGraduationManagerV3 public immutable graduationManager;
    address public immutable override tokenDeployer;
    address public immutable override curveDeployer;

    mapping(address token => TokenInfo info) public override tokenInfo;
    mapping(address token => bool) public override isToken;
    mapping(address token => address curve) public override curveOf;
    mapping(bytes32 definition => address token) public definitionToken;
    mapping(address creator => address[] tokens) private _tokensByCreator;

    constructor(address feeManager_, address graduationManager_) {
        if (feeManager_ == address(0) || feeManager_.code.length == 0) revert InvalidFeeManager();
        if (graduationManager_ == address(0) || graduationManager_.code.length == 0) {
            revert InvalidGraduationManager();
        }
        feeManager = IFeeManagerV3(feeManager_);
        graduationManager = IGraduationManagerV3(graduationManager_);
        tokenDeployer = address(new TokenDeployerV3(graduationManager_));
        curveDeployer = address(new CurveDeployerV3(feeManager_, graduationManager_));
    }

    function createToken(string calldata name, string calldata symbol, bytes32 userSalt)
        external
        override
        returns (address token, address curve)
    {
        _requireCanonicalDependencies();
        _validateMetadata(name, symbol);
        if (userSalt == bytes32(0)) revert InvalidUserSalt();
        bytes32 definition = keccak256(abi.encode(msg.sender, name, symbol));
        if (definitionToken[definition] != address(0)) revert DuplicateToken();

        bytes32 launchSeed;
        bytes32 candidateSalt;
        uint16 attemptIndex;
        (token, launchSeed, candidateSalt, attemptIndex) =
            ITokenDeployerV3(tokenDeployer).deployToken(msg.sender, userSalt, name, symbol);
        curve = ICurveDeployerV3(curveDeployer).deployCurve(token, msg.sender);

        CooketTokenV3 createdToken = CooketTokenV3(token);
        createdToken.initialize(curve);
        if (
            createdToken.totalSupply() != TOTAL_SUPPLY || createdToken.balanceOf(curve) != TOTAL_SUPPLY
                || createdToken.balanceOf(msg.sender) != 0
        ) revert InventoryMismatch();

        definitionToken[definition] = token;
        tokenInfo[token] = TokenInfo({creator: msg.sender, curve: curve});
        isToken[token] = true;
        curveOf[token] = curve;
        _tokensByCreator[msg.sender].push(token);
        feeManager.registerToken(token, curve, msg.sender);
        address canonicalPool =
            graduationManager.registerLaunch(token, curve, msg.sender, launchSeed, candidateSalt, attemptIndex);

        emit TokenLaunchedV3(
            msg.sender,
            token,
            curve,
            PROTOCOL_VERSION,
            TOTAL_SUPPLY,
            CURVE_ALLOCATION,
            LP_ALLOCATION,
            msg.sender,
            canonicalPool,
            launchSeed,
            candidateSalt,
            attemptIndex
        );
    }

    function tokensByCreator(address creator) external view override returns (address[] memory) {
        return _tokensByCreator[creator];
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function _validateMetadata(string calldata name, string calldata symbol) private pure {
        if (bytes(name).length == 0 || bytes(name).length > EndpointConstantsV3.MAX_TOKEN_NAME_LENGTH) {
            revert InvalidTokenName();
        }
        if (bytes(symbol).length == 0 || bytes(symbol).length > EndpointConstantsV3.MAX_TOKEN_SYMBOL_LENGTH) {
            revert InvalidTokenSymbol();
        }
    }

    function _requireCanonicalDependencies() private view {
        if (feeManager.factory() != address(this) || graduationManager.factory() != address(this)) {
            revert DependencyFactoryMismatch();
        }
        if (
            feeManager.protocolVersionHash() != PROTOCOL_VERSION_HASH
                || graduationManager.protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ITokenDeployerV3(tokenDeployer).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ICurveDeployerV3(curveDeployer).protocolVersionHash() != PROTOCOL_VERSION_HASH
        ) revert DependencyVersionMismatch();
        if (
            ITokenDeployerV3(tokenDeployer).factory() != address(this)
                || ITokenDeployerV3(tokenDeployer).graduationManager() != address(graduationManager)
        ) revert InvalidTokenDeployer();
        if (
            ICurveDeployerV3(curveDeployer).factory() != address(this)
                || ICurveDeployerV3(curveDeployer).feeManager() != address(feeManager)
                || ICurveDeployerV3(curveDeployer).graduationManager() != address(graduationManager)
        ) revert InvalidCurveDeployer();
    }
}
