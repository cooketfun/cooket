// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EndpointConstantsV4} from "./libraries/EndpointConstantsV4.sol";
import {IFeeManagerV4} from "./interfaces/IFeeManagerV4.sol";
import {IGraduationManagerV4} from "./interfaces/IGraduationManagerV4.sol";
import {ICooketFactoryV4} from "./interfaces/ICooketFactoryV4.sol";
import {ICooketCurveV4} from "./interfaces/ICooketCurveV4.sol";
import {ICurveDeployerV4} from "./interfaces/ICurveDeployerV4.sol";
import {ITokenDeployerV4} from "./interfaces/ITokenDeployerV4.sol";
import {CurveDeployerV4} from "./CurveDeployerV4.sol";
import {TokenDeployerV4} from "./TokenDeployerV4.sol";
import {CooketTokenV4} from "./CooketTokenV4.sol";

/// @notice Atomic launcher and registry for the separate endpoint-cp-v4 family.
contract CooketFactoryV4 is ICooketFactoryV4 {
    string public constant PROTOCOL_VERSION = "endpoint-cp-v4";
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("endpoint-cp-v4");
    uint256 public constant TOTAL_SUPPLY = EndpointConstantsV4.TOTAL_SUPPLY;
    uint256 public constant CURVE_ALLOCATION = EndpointConstantsV4.CURVE_ALLOCATION;
    uint256 public constant LP_ALLOCATION = EndpointConstantsV4.LP_ALLOCATION;

    IFeeManagerV4 public immutable feeManager;
    IGraduationManagerV4 public immutable graduationManager;
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
        feeManager = IFeeManagerV4(feeManager_);
        graduationManager = IGraduationManagerV4(graduationManager_);
        tokenDeployer = address(new TokenDeployerV4(graduationManager_));
        curveDeployer = address(new CurveDeployerV4(feeManager_, graduationManager_));
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
            ITokenDeployerV4(tokenDeployer).deployToken(msg.sender, userSalt, name, symbol);
        curve = ICurveDeployerV4(curveDeployer).deployCurve(token, msg.sender);

        CooketTokenV4 createdToken = CooketTokenV4(token);
        createdToken.initialize(curve);
        if (
            createdToken.totalSupply() != TOTAL_SUPPLY || createdToken.balanceOf(curve) != TOTAL_SUPPLY
                || createdToken.balanceOf(msg.sender) != 0
                || createdToken.protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ICooketCurveV4(curve).protocolVersionHash() != PROTOCOL_VERSION_HASH
        ) revert InventoryMismatch();

        definitionToken[definition] = token;
        tokenInfo[token] = TokenInfo({creator: msg.sender, curve: curve});
        isToken[token] = true;
        curveOf[token] = curve;
        _tokensByCreator[msg.sender].push(token);
        feeManager.registerToken(token, curve, msg.sender);
        address canonicalPool =
            graduationManager.registerLaunch(token, curve, msg.sender, launchSeed, candidateSalt, attemptIndex);

        emit TokenLaunchedV4(
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
        if (bytes(name).length == 0 || bytes(name).length > EndpointConstantsV4.MAX_TOKEN_NAME_LENGTH) {
            revert InvalidTokenName();
        }
        if (bytes(symbol).length == 0 || bytes(symbol).length > EndpointConstantsV4.MAX_TOKEN_SYMBOL_LENGTH) {
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
                || ITokenDeployerV4(tokenDeployer).protocolVersionHash() != PROTOCOL_VERSION_HASH
                || ICurveDeployerV4(curveDeployer).protocolVersionHash() != PROTOCOL_VERSION_HASH
        ) revert DependencyVersionMismatch();
        if (
            ITokenDeployerV4(tokenDeployer).factory() != address(this)
                || ITokenDeployerV4(tokenDeployer).graduationManager() != address(graduationManager)
        ) revert InvalidTokenDeployer();
        if (
            ICurveDeployerV4(curveDeployer).factory() != address(this)
                || ICurveDeployerV4(curveDeployer).feeManager() != address(feeManager)
                || ICurveDeployerV4(curveDeployer).graduationManager() != address(graduationManager)
        ) revert InvalidCurveDeployer();
    }
}
