// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Canonical unit definitions for Arc native USDC and its ERC-20 interface.
library ArcNativeUsdcV3 {
    uint256 internal constant NATIVE_USDC_UNIT = 1e18;
    uint256 internal constant ERC20_USDC_UNIT = 1e6;
    uint256 internal constant NATIVE_PER_ERC20_BASE_UNIT = 1e12;
    address internal constant CANONICAL_USDC = 0x3600000000000000000000000000000000000000;

    error NativeUsdcAmountNotExactlyRepresentable(uint256 nativeUsdcAmount);
    error Usdc6ToNativeUsdcOverflow(uint256 usdc6Amount);

    function nativeUsdcToUsdc6Exact(uint256 nativeUsdcAmount) internal pure returns (uint256 usdc6Amount) {
        if (nativeUsdcAmount % NATIVE_PER_ERC20_BASE_UNIT != 0) {
            revert NativeUsdcAmountNotExactlyRepresentable(nativeUsdcAmount);
        }
        return nativeUsdcAmount / NATIVE_PER_ERC20_BASE_UNIT;
    }

    function usdc6ToNativeUsdc(uint256 usdc6Amount) internal pure returns (uint256 nativeUsdcAmount) {
        if (usdc6Amount > type(uint256).max / NATIVE_PER_ERC20_BASE_UNIT) {
            revert Usdc6ToNativeUsdcOverflow(usdc6Amount);
        }
        return usdc6Amount * NATIVE_PER_ERC20_BASE_UNIT;
    }
}
