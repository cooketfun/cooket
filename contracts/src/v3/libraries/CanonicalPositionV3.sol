// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {INonfungiblePositionManagerV3} from "../interfaces/INonfungiblePositionManagerV3.sol";

/// @notice Strict decoder for the static canonical Uniswap V3 positions tuple.
library CanonicalPositionV3 {
    uint256 private constant POSITIONS_RETURN_LENGTH = 384;

    function isCanonicalFullRangePosition(
        address positionManager,
        uint256 tokenId,
        address expectedToken0,
        address expectedToken1
    ) internal view returns (bool valid) {
        (bool ok, bytes memory data) = positionManager.staticcall(
            abi.encodeWithSelector(INonfungiblePositionManagerV3.positions.selector, tokenId)
        );
        if (!ok || data.length != POSITIONS_RETURN_LENGTH) return false;

        uint256 rawToken0;
        uint256 rawToken1;
        uint256 rawFee;
        int256 rawLower;
        int256 rawUpper;
        assembly ("memory-safe") {
            rawToken0 := mload(add(data, 96))
            rawToken1 := mload(add(data, 128))
            rawFee := mload(add(data, 160))
            rawLower := mload(add(data, 192))
            rawUpper := mload(add(data, 224))
        }
        if (rawToken0 > type(uint160).max || rawToken1 > type(uint160).max || rawFee > type(uint24).max) {
            return false;
        }

        int256 tickLower;
        int256 tickUpper;
        assembly ("memory-safe") {
            tickLower := signextend(2, rawLower)
            tickUpper := signextend(2, rawUpper)
        }
        if (rawLower != tickLower || rawUpper != tickUpper) return false;
        return address(uint160(rawToken0)) == expectedToken0 && address(uint160(rawToken1)) == expectedToken1
            && rawFee == 10_000 && tickLower == -887_200 && tickUpper == 887_200;
    }
}
