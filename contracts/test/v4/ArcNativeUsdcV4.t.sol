// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcNativeUsdcV4} from "../../src/v4/libraries/ArcNativeUsdcV4.sol";

contract ArcNativeUsdcV4Test is Test {
    function testCanonicalUnits() public pure {
        assertEq(ArcNativeUsdcV4.NATIVE_USDC_UNIT, 1e18);
        assertEq(ArcNativeUsdcV4.ERC20_USDC_UNIT, 1e6);
        assertEq(ArcNativeUsdcV4.NATIVE_PER_ERC20_BASE_UNIT, 1e12);
    }

    function testExactNativeUsdcToUsdc6Conversions() public pure {
        assertEq(ArcNativeUsdcV4.nativeUsdcToUsdc6Exact(0), 0);
        assertEq(ArcNativeUsdcV4.nativeUsdcToUsdc6Exact(1e12), 1);
        assertEq(ArcNativeUsdcV4.nativeUsdcToUsdc6Exact(14_490e18), 14_490e6);
    }

    function testNativeUsdcToUsdc6RejectsNonDivisibleAmount() public {
        vm.expectRevert(
            abi.encodeWithSelector(ArcNativeUsdcV4.NativeUsdcAmountNotExactlyRepresentable.selector, 1e12 + 1)
        );
        this.nativeUsdcToUsdc6Exact(1e12 + 1);
    }

    function testUsdc6RoundTripReturnsOriginalExactNativeAmount() public pure {
        uint256 nativeUsdcAmount = 14_490e18;
        uint256 usdc6Amount = ArcNativeUsdcV4.nativeUsdcToUsdc6Exact(nativeUsdcAmount);
        assertEq(ArcNativeUsdcV4.usdc6ToNativeUsdc(usdc6Amount), nativeUsdcAmount);
    }

    function testUsdc6ToNativeUsdcRejectsOverflow() public {
        uint256 overflowingAmount = type(uint256).max / ArcNativeUsdcV4.NATIVE_PER_ERC20_BASE_UNIT + 1;
        vm.expectRevert(abi.encodeWithSelector(ArcNativeUsdcV4.Usdc6ToNativeUsdcOverflow.selector, overflowingAmount));
        this.usdc6ToNativeUsdc(overflowingAmount);
    }

    function nativeUsdcToUsdc6Exact(uint256 nativeUsdcAmount) external pure returns (uint256) {
        return ArcNativeUsdcV4.nativeUsdcToUsdc6Exact(nativeUsdcAmount);
    }

    function usdc6ToNativeUsdc(uint256 usdc6Amount) external pure returns (uint256) {
        return ArcNativeUsdcV4.usdc6ToNativeUsdc(usdc6Amount);
    }
}
