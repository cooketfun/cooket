// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {EndpointConstantsV5} from "./EndpointConstantsV5.sol";

/// @notice Constructs and authenticates the unique Cooket V5 launch-token/USDC pool key.
library CanonicalPoolV5 {
    error InvalidCurrency();
    error InvalidHook();
    error NonCanonicalPoolKey();

    function key(address launchToken, address canonicalUsdc, address hook)
        internal
        pure
        returns (PoolKey memory result)
    {
        if (launchToken == address(0) || canonicalUsdc == address(0) || launchToken == canonicalUsdc) {
            revert InvalidCurrency();
        }
        if (hook == address(0)) revert InvalidHook();
        (address token0, address token1) =
            launchToken < canonicalUsdc ? (launchToken, canonicalUsdc) : (canonicalUsdc, launchToken);
        result = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: EndpointConstantsV5.POOL_FEE,
            tickSpacing: EndpointConstantsV5.POOL_TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    function validate(PoolKey calldata candidate, address launchToken, address canonicalUsdc, address hook)
        internal
        pure
    {
        PoolKey memory expected = key(launchToken, canonicalUsdc, hook);
        if (
            Currency.unwrap(candidate.currency0) != Currency.unwrap(expected.currency0)
                || Currency.unwrap(candidate.currency1) != Currency.unwrap(expected.currency1)
                || candidate.fee != expected.fee || candidate.tickSpacing != expected.tickSpacing
                || address(candidate.hooks) != address(expected.hooks)
        ) revert NonCanonicalPoolKey();
    }

    function id(PoolKey memory poolKey) internal pure returns (PoolId) {
        return poolKey.toId();
    }
}
