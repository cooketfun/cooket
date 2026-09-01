// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {INonfungiblePositionManagerV3} from "../../../src/v3/interfaces/INonfungiblePositionManagerV3.sol";

contract MockNonfungiblePositionManagerV3 {
    struct Position {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
    }

    address public immutable factory;
    address public immutable WETH9;
    mapping(uint256 tokenId => address owner) private _ownerOf;
    mapping(uint256 tokenId => Position position) private _positionOf;
    mapping(uint256 tokenId => uint256 amount0) public collectable0;
    mapping(uint256 tokenId => uint256 amount1) public collectable1;
    bool public revertCollect;
    bool public revertMint;
    /// @dev 0 canonical; 1 partial token report; 2 partial WETH report;
    /// 3 zero liquidity; 4 mint a position the custodian must reject.
    uint8 public mintResponseMode;
    uint256 public nextTokenId = 100;
    uint8 public positionsResponseMode;
    uint256 public malformedToken0;
    uint256 public malformedToken1;
    uint256 public malformedFee;
    uint256 public malformedTickLower;
    uint256 public malformedTickUpper;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH9 = weth_;
    }

    function setPosition(
        uint256 tokenId,
        address owner,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper
    ) external {
        _ownerOf[tokenId] = owner;
        _positionOf[tokenId] = Position(token0, token1, fee, tickLower, tickUpper);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _ownerOf[tokenId];
        require(owner != address(0), "INVALID_TOKEN_ID");
        return owner;
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function setCollectableFees(uint256 tokenId, uint256 amount0, uint256 amount1) external {
        collectable0[tokenId] = amount0;
        collectable1[tokenId] = amount1;
    }

    function setRevertCollect(bool value) external {
        revertCollect = value;
    }

    function setRevertMint(bool value) external {
        revertMint = value;
    }

    function setMintResponseMode(uint8 mode) external {
        mintResponseMode = mode;
    }

    function mint(INonfungiblePositionManagerV3.MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        if (revertMint) revert("MINT_REVERTED");
        require(params.fee == 10_000 && params.tickLower == -887_200 && params.tickUpper == 887_200, "BAD_RANGE");
        require(params.amount0Min <= params.amount0Desired && params.amount1Min <= params.amount1Desired, "BAD_MIN");
        amount0 = params.amount0Min;
        amount1 = params.amount1Min;
        IERC20(params.token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(params.token1).transferFrom(msg.sender, address(this), amount1);
        tokenId = nextTokenId++;
        liquidity = mintResponseMode == 3 ? 0 : 1;
        if (mintResponseMode == 1) amount0 -= 1;
        if (mintResponseMode == 2) amount1 -= 1;
        _ownerOf[tokenId] = params.recipient;
        _positionOf[tokenId] = Position(
            params.token0,
            params.token1,
            mintResponseMode == 4 ? uint24(3_000) : params.fee,
            params.tickLower,
            params.tickUpper
        );
    }

    /// @dev Modes: 0 canonical; 1 revert; 2 short; 3 long; 4 custom words.
    function setPositionsResponseMode(uint8 mode) external {
        positionsResponseMode = mode;
    }

    function setMalformedPositionWords(
        uint256 token0_,
        uint256 token1_,
        uint256 fee_,
        uint256 tickLower_,
        uint256 tickUpper_
    ) external {
        malformedToken0 = token0_;
        malformedToken1 = token1_;
        malformedFee = fee_;
        malformedTickLower = tickLower_;
        malformedTickUpper = tickUpper_;
    }

    function collect(INonfungiblePositionManagerV3.CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        if (revertCollect) revert("COLLECT_REVERTED");
        require(_ownerOf[params.tokenId] == msg.sender, "NOT_OWNER");
        Position memory position = _positionOf[params.tokenId];
        amount0 = collectable0[params.tokenId] > params.amount0Max ? params.amount0Max : collectable0[params.tokenId];
        amount1 = collectable1[params.tokenId] > params.amount1Max ? params.amount1Max : collectable1[params.tokenId];
        collectable0[params.tokenId] -= amount0;
        collectable1[params.tokenId] -= amount1;
        if (amount0 != 0) IERC20(position.token0).transfer(params.recipient, amount0);
        if (amount1 != 0) IERC20(position.token1).transfer(params.recipient, amount1);
    }

    fallback() external {
        require(msg.sig == bytes4(keccak256("positions(uint256)")), "UNSUPPORTED");
        if (positionsResponseMode == 1) revert("POSITIONS_REVERTED");
        uint8 mode = positionsResponseMode;
        uint256 tokenId;
        assembly ("memory-safe") {
            tokenId := calldataload(4)
        }
        require(_ownerOf[tokenId] != address(0), "INVALID_TOKEN_ID");
        Position memory position = _positionOf[tokenId];
        assembly ("memory-safe") {
            let result := mload(0x40)
            mstore(result, 0)
            mstore(add(result, 32), 0)
            switch mode
            case 4 {
                mstore(add(result, 64), sload(malformedToken0.slot))
                mstore(add(result, 96), sload(malformedToken1.slot))
                mstore(add(result, 128), sload(malformedFee.slot))
                mstore(add(result, 160), sload(malformedTickLower.slot))
                mstore(add(result, 192), sload(malformedTickUpper.slot))
            }
            default {
                mstore(add(result, 64), mload(position))
                mstore(add(result, 96), mload(add(position, 32)))
                mstore(add(result, 128), mload(add(position, 64)))
                mstore(add(result, 160), mload(add(position, 96)))
                mstore(add(result, 192), mload(add(position, 128)))
            }
            mstore(add(result, 224), 1)
            mstore(add(result, 256), 0)
            mstore(add(result, 288), 0)
            mstore(add(result, 320), 0)
            mstore(add(result, 352), 0)
            switch mode
            case 2 { return(result, 352) }
            case 3 { return(result, 416) }
            default { return(result, 384) }
        }
    }
}
