// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGraduationManagerV3} from "./interfaces/IGraduationManagerV3.sol";
import {IFeeManagerV3} from "./interfaces/IFeeManagerV3.sol";
import {INonfungiblePositionManagerV3} from "./interfaces/INonfungiblePositionManagerV3.sol";
import {IPermanentLPCustodianV3} from "./interfaces/IPermanentLPCustodianV3.sol";
import {IPermanentLPFeeVaultV3} from "./interfaces/IPermanentLPFeeVaultV3.sol";
import {ICooketFactoryV3} from "./interfaces/ICooketFactoryV3.sol";
import {CanonicalPositionV3} from "./libraries/CanonicalPositionV3.sol";
import {ArcNativeUsdcV3} from "./libraries/ArcNativeUsdcV3.sol";

/// @notice Ownerless, non-upgradeable permanent custody for one Cooket V3 LP NFT.
/// @dev This contract intentionally has no receive/fallback, ERC721 receiver,
/// transfer, approval, rescue, delegatecall, or external-call capability.
contract PermanentLPCustodianV3 is IPermanentLPCustodianV3 {
    bytes32 public constant PROTOCOL_VERSION_HASH = keccak256("COOKET_ARC_V1_CUSTODY");
    uint24 public constant EXPECTED_FEE = 10_000;
    int24 public constant FULL_RANGE_TICK_LOWER = -887_200;
    int24 public constant FULL_RANGE_TICK_UPPER = 887_200;

    address public immutable launchToken;
    address public constant canonicalUsdc = ArcNativeUsdcV3.CANONICAL_USDC;
    address public immutable graduationManager;
    address public immutable feeVault;
    address public immutable nonfungiblePositionManager;
    address public immutable canonicalFactory;
    uint256 public positionTokenId;
    bool public positionRegistered;

    constructor(
        address launchToken_,
        address nonfungiblePositionManager_,
        address graduationManager_,
        address feeVault_
    ) {
        if (
            launchToken_ == address(0) || launchToken_ == canonicalUsdc || launchToken_.code.length == 0
                || canonicalUsdc.code.length == 0 || nonfungiblePositionManager_ == address(0)
                || nonfungiblePositionManager_.code.length == 0 || graduationManager_ == address(0)
                || graduationManager_.code.length == 0 || feeVault_ == address(0) || feeVault_.code.length == 0
        ) revert InvalidDependency();

        IGraduationManagerV3 manager = IGraduationManagerV3(graduationManager_);
        IPermanentLPFeeVaultV3 vault = IPermanentLPFeeVaultV3(feeVault_);
        IFeeManagerV3 fees = IFeeManagerV3(vault.feeManager());
        address factory_ = manager.factory();
        if (
            factory_ == address(0) || factory_.code.length == 0
                || manager.protocolVersionHash() != keccak256("endpoint-cp-v3")
                || manager.canonicalUsdc() != canonicalUsdc || vault.protocolVersionHash() != PROTOCOL_VERSION_HASH
                || vault.factory() != factory_ || vault.graduationManager() != graduationManager_
                || vault.canonicalUsdc() != canonicalUsdc || vault.feeManager() == address(0)
                || vault.feeManager().code.length == 0 || fees.protocolVersionHash() != keccak256("endpoint-cp-v3")
                || fees.factory() != factory_
                || INonfungiblePositionManagerV3(nonfungiblePositionManager_).factory() != manager.uniswapV3Factory()
        ) revert InvalidDependency();

        (address curve, address creator, bool registered,) = manager.launchOf(launchToken_);
        if (
            !registered || curve == address(0) || creator == address(0)
                || !ICooketFactoryV3(factory_).isToken(launchToken_)
                || ICooketFactoryV3(factory_).curveOf(launchToken_) != curve || fees.curveOf(launchToken_) != curve
                || fees.creatorOf(launchToken_) != creator
        ) revert InvalidDependency();

        launchToken = launchToken_;
        nonfungiblePositionManager = nonfungiblePositionManager_;
        graduationManager = graduationManager_;
        feeVault = feeVault_;
        canonicalFactory = factory_;
    }

    function protocolVersionHash() external pure override returns (bytes32) {
        return PROTOCOL_VERSION_HASH;
    }

    function boundTokenId() external view override returns (uint256) {
        return positionTokenId;
    }

    /// @notice Irreversibly binds the NFT minted directly to this custodian.
    function bindPosition(uint256 tokenId) external override {
        if (msg.sender != graduationManager) revert UnauthorizedGraduationManager();
        if (tokenId == 0) revert InvalidTokenId();
        if (positionRegistered) revert AlreadyRegistered();
        INonfungiblePositionManagerV3 positions = INonfungiblePositionManagerV3(nonfungiblePositionManager);
        if (positions.ownerOf(tokenId) != address(this)) revert InvalidPosition();
        _validatePosition(tokenId);

        positionTokenId = tokenId;
        positionRegistered = true;
        emit PermanentPositionRegistered(
            launchToken, tokenId, nonfungiblePositionManager, FULL_RANGE_TICK_LOWER, FULL_RANGE_TICK_UPPER
        );
    }

    /// @notice Permissionlessly collects only accrued position fees to FeeManagerV3.
    /// @dev Principal remains locked because this contract has no decrease-liquidity
    /// or approval path; canonical `collect` cannot withdraw principal by itself.
    function collectFees() external override returns (uint256 amount0, uint256 amount1) {
        if (!positionRegistered) revert PositionNotRegistered();
        (amount0, amount1) = INonfungiblePositionManagerV3(nonfungiblePositionManager)
            .collect(
                INonfungiblePositionManagerV3.CollectParams({
                    tokenId: positionTokenId,
                    recipient: feeVault,
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );
        IPermanentLPFeeVaultV3(feeVault).notifyPermanentLPFees(launchToken, amount0, amount1);
        emit PermanentFeesCollected(positionTokenId, amount0, amount1);
    }

    function _validatePosition(uint256 tokenId) private view {
        (address expected0, address expected1) =
            launchToken < canonicalUsdc ? (launchToken, canonicalUsdc) : (canonicalUsdc, launchToken);
        if (!CanonicalPositionV3.isCanonicalFullRangePosition(
                nonfungiblePositionManager, tokenId, expected0, expected1
            )) {
            revert InvalidPosition();
        }
    }
}
