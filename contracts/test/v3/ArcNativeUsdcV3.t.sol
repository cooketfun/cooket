// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcNativeUsdcV3} from "../../src/v3/libraries/ArcNativeUsdcV3.sol";

contract ArcNativeUsdcV3Test is Test {
    function testCanonicalUnitsAndAddress() public pure {
        assertEq(ArcNativeUsdcV3.NATIVE_USDC_UNIT, 1e18);
        assertEq(ArcNativeUsdcV3.ERC20_USDC_UNIT, 1e6);
        assertEq(ArcNativeUsdcV3.NATIVE_PER_ERC20_BASE_UNIT, 1e12);
        assertEq(ArcNativeUsdcV3.CANONICAL_USDC, 0x3600000000000000000000000000000000000000);
    }

    function testExactNativeUsdcToUsdc6Conversions() public pure {
        assertEq(ArcNativeUsdcV3.nativeUsdcToUsdc6Exact(0), 0);
        assertEq(ArcNativeUsdcV3.nativeUsdcToUsdc6Exact(1e12), 1);
        assertEq(ArcNativeUsdcV3.nativeUsdcToUsdc6Exact(7_245e18), 7_245e6);
    }

    function testNativeUsdcToUsdc6RejectsNonDivisibleAmount() public {
        vm.expectRevert(
            abi.encodeWithSelector(ArcNativeUsdcV3.NativeUsdcAmountNotExactlyRepresentable.selector, 1e12 + 1)
        );
        this.nativeUsdcToUsdc6Exact(1e12 + 1);
    }

    function testUsdc6RoundTripReturnsOriginalExactNativeAmount() public pure {
        uint256 nativeUsdcAmount = 7_245e18;
        uint256 usdc6Amount = ArcNativeUsdcV3.nativeUsdcToUsdc6Exact(nativeUsdcAmount);
        assertEq(ArcNativeUsdcV3.usdc6ToNativeUsdc(usdc6Amount), nativeUsdcAmount);
    }

    function testUsdc6ToNativeUsdcRejectsOverflow() public {
        uint256 overflowingAmount = type(uint256).max / ArcNativeUsdcV3.NATIVE_PER_ERC20_BASE_UNIT + 1;
        vm.expectRevert(abi.encodeWithSelector(ArcNativeUsdcV3.Usdc6ToNativeUsdcOverflow.selector, overflowingAmount));
        this.usdc6ToNativeUsdc(overflowingAmount);
    }

    function nativeUsdcToUsdc6Exact(uint256 nativeUsdcAmount) external pure returns (uint256) {
        return ArcNativeUsdcV3.nativeUsdcToUsdc6Exact(nativeUsdcAmount);
    }

    function usdc6ToNativeUsdc(uint256 usdc6Amount) external pure returns (uint256) {
        return ArcNativeUsdcV3.usdc6ToNativeUsdc(usdc6Amount);
    }
}
