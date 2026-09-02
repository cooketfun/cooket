// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GraduationManagerV3Boundary} from "../../../src/v3/GraduationManagerV3Boundary.sol";

contract MockGraduationManagerV3 is GraduationManagerV3Boundary {
    mapping(address => address) public override residualEscrowOf;
    bool public shouldRevert;
    bool public shouldRevertRegistration;
    address public reentryTarget;
    bytes public reentryData;
    bool public reentrySucceeded;
    uint256 public calls;
    uint256 public registrationCalls;
    address public lastToken;
    address public lastCreator;
    uint256 public lastTokenAmount;
    uint256 public lastNativeUsdcAmount;
    address public mutationPool;
    uint160 public mutationSqrtPriceX96;
    uint128 public mutationLiquidity;

    constructor(address uniswapV3Factory_) GraduationManagerV3Boundary(uniswapV3Factory_) {}

    function configure(bool shouldRevert_, address reentryTarget_, bytes calldata reentryData_) external {
        shouldRevert = shouldRevert_;
        reentryTarget = reentryTarget_;
        reentryData = reentryData_;
    }

    function configureRegistrationFailure(bool shouldRevertRegistration_) external {
        shouldRevertRegistration = shouldRevertRegistration_;
    }

    function configurePoolMutation(address pool, uint160 sqrtPriceX96, uint128 liquidity) external {
        mutationPool = pool;
        mutationSqrtPriceX96 = sqrtPriceX96;
        mutationLiquidity = liquidity;
    }

    function graduate(address token, address creator, uint256 tokenAmount, uint256 nativeUsdcAmount)
        external
        payable
        override
    {
        _authorizeGraduation(token, creator);
        if (shouldRevert) revert("GRADUATION_FAILED");
        require(msg.value == nativeUsdcAmount, "NATIVE_USDC_MISMATCH");
        require(IERC20(token).balanceOf(address(this)) >= tokenAmount, "TOKEN_MISMATCH");
        if (reentryTarget != address(0)) (reentrySucceeded,) = reentryTarget.call(reentryData);
        calls += 1;
        lastToken = token;
        lastCreator = creator;
        lastTokenAmount = tokenAmount;
        lastNativeUsdcAmount = nativeUsdcAmount;
    }

    function _afterLaunchRegistered(address, address, address) internal override {
        registrationCalls += 1;
        if (shouldRevertRegistration) revert("REGISTRATION_FAILED");
    }

    function _beforePoolReservation(address) internal override {
        if (mutationPool == address(0)) return;
        if (mutationSqrtPriceX96 != 0) {
            (bool ok,) = mutationPool.call(abi.encodeWithSignature("initialize(uint160)", mutationSqrtPriceX96));
            require(ok, "PRICE_MUTATION_FAILED");
        }
        if (mutationLiquidity != 0) {
            (bool ok,) = mutationPool.call(abi.encodeWithSignature("setLiquidity(uint128)", mutationLiquidity));
            require(ok, "LIQUIDITY_MUTATION_FAILED");
        }
    }
}
