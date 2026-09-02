// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArcNativeUsdcV3} from "./ArcNativeUsdcV3.sol";

/// @notice Canonical endpoint-cp-v3 economic constants.
library EndpointConstantsV3 {
    string internal constant PROTOCOL_VERSION = "endpoint-cp-v3";

    uint8 internal constant TOKEN_DECIMALS = 18;
    uint256 internal constant TOKEN_UNIT = 1e18;
    uint256 internal constant NATIVE_USDC_UNIT = ArcNativeUsdcV3.NATIVE_USDC_UNIT;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 * TOKEN_UNIT;
    uint256 internal constant CURVE_ALLOCATION = 800_000_000 * TOKEN_UNIT;
    uint256 internal constant LP_ALLOCATION = 200_000_000 * TOKEN_UNIT;

    uint256 internal constant VIRTUAL_TOKEN_RESERVE = 1_066_666_666_666_666_666_666_666_667;
    uint256 internal constant VIRTUAL_NATIVE_USDC_RESERVE = 2_415 * NATIVE_USDC_UNIT;
    uint256 internal constant GRADUATION_NATIVE_USDC_RESERVE = 7_245 * NATIVE_USDC_UNIT;
    uint256 internal constant K = VIRTUAL_TOKEN_RESERVE * VIRTUAL_NATIVE_USDC_RESERVE;

    uint256 internal constant FEE_DENOMINATOR = 10_000;
    uint256 internal constant TOTAL_FEE_BPS = 100;
    uint256 internal constant FEE_SPLIT_DENOMINATOR = 100;
    uint256 internal constant CREATOR_FEE_PERCENT = 35;
    uint256 internal constant COMMUNITY_FEE_PERCENT = 20;
    uint256 internal constant TRADER_REWARDS_FEE_PERCENT = 15;
    bytes32 internal constant FEE_POLICY_HASH = keccak256("cooket-fee-design-b-v3");
    uint256 internal constant LP_CREATOR_FEE_PERCENT = 25;
    uint256 internal constant LP_COMMUNITY_FEE_PERCENT = 30;
    uint256 internal constant LP_TRADER_REWARDS_FEE_PERCENT = 15;
    uint256 internal constant NET_GROSS_ADJUSTMENT_DENOMINATOR = (FEE_DENOMINATOR - TOTAL_FEE_BPS) / TOTAL_FEE_BPS;
    uint256 internal constant INITIAL_NATIVE_USDC_PRICE = 2_264_062_500_000;
    uint256 internal constant TERMINAL_NATIVE_USDC_PRICE = 36_225_000_000_000;
    uint256 internal constant EXACT_GRADUATION_GROSS_NATIVE_USDC = 7_318_181_818_181_818_181_818;

    uint256 internal constant MAX_TOKEN_NAME_LENGTH = 64;
    uint256 internal constant MAX_TOKEN_SYMBOL_LENGTH = 16;
}
