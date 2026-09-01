// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IUniswapV3FactoryMinimal} from "../../../src/v3/interfaces/uniswap/IUniswapV3FactoryMinimal.sol";
import {IUniswapV3PoolMinimal} from "../../../src/v3/interfaces/uniswap/IUniswapV3PoolMinimal.sol";

contract MockWETHV3 is ERC20 {
    constructor() ERC20("Mock WETH", "WETH") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "ETH_SEND_FAILED");
    }

    receive() external payable {}
}

contract MockUniswapV3PoolV3 is IUniswapV3PoolMinimal {
    address public immutable override factory;
    address public immutable override token0;
    address public immutable override token1;
    uint24 public immutable override fee;
    int24 public immutable override tickSpacing;
    uint128 public override liquidity;
    uint160 private _sqrtPriceX96;

    constructor(address token0_, address token1_, uint24 fee_, int24 tickSpacing_) {
        factory = msg.sender;
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        tickSpacing = tickSpacing_;
    }

    function initialize(uint160 sqrtPriceX96_) external override {
        require(_sqrtPriceX96 == 0 && sqrtPriceX96_ != 0, "ALREADY_INITIALIZED");
        _sqrtPriceX96 = sqrtPriceX96_;
    }

    function setLiquidity(uint128 liquidity_) external {
        liquidity = liquidity_;
    }

    function slot0() external view override returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (_sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}

    /// @notice Fully responsive pool fixture for relationship-policy rejection tests.
    contract MockConfiguredUniswapV3PoolV3 is IUniswapV3PoolMinimal {
        address public override factory;
        address public override token0;
        address public override token1;
        uint24 public override fee;
        int24 public override tickSpacing;
        uint128 public override liquidity;
        uint160 private _sqrtPriceX96;

        constructor(
            address factory_,
            address token0_,
            address token1_,
            uint24 fee_,
            int24 tickSpacing_,
            uint160 sqrtPriceX96_,
            uint128 liquidity_
        ) {
            factory = factory_;
            token0 = token0_;
            token1 = token1_;
            fee = fee_;
            tickSpacing = tickSpacing_;
            _sqrtPriceX96 = sqrtPriceX96_;
            liquidity = liquidity_;
        }

        function initialize(uint160 sqrtPriceX96_) external override {
            require(_sqrtPriceX96 == 0 && sqrtPriceX96_ != 0, "ALREADY_INITIALIZED");
            _sqrtPriceX96 = sqrtPriceX96_;
        }

        function slot0() external view override returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
            return (_sqrtPriceX96, 0, 0, 0, 0, 0, true);
        }
    }

        contract MockUniswapV3FactoryV3 is IUniswapV3FactoryMinimal {
            mapping(bytes32 key => address pool) private _pools;

            function feeAmountTickSpacing(uint24 fee) external pure override returns (int24) {
                return fee == 10_000 ? int24(200) : int24(0);
            }

            function getPool(address tokenA, address tokenB, uint24 fee) external view override returns (address) {
                return _pools[_key(tokenA, tokenB, fee)];
            }

            function createPool(address tokenA, address tokenB, uint24 fee) external override returns (address pool) {
                require(tokenA != tokenB && tokenA != address(0) && tokenB != address(0), "INVALID_TOKENS");
                require(fee == 10_000, "INVALID_FEE");
                bytes32 key = _key(tokenA, tokenB, fee);
                require(_pools[key] == address(0), "POOL_EXISTS");
                (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
                pool = address(new MockUniswapV3PoolV3(token0, token1, fee, 200));
                _pools[key] = pool;
            }

            function forcePool(address tokenA, address tokenB, uint24 fee, address pool) external {
                _pools[_key(tokenA, tokenB, fee)] = pool;
            }

            function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
                (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
                return keccak256(abi.encode(token0, token1, fee));
            }
        }
