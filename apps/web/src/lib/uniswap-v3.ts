import { encodeFunctionData, getAddress, type Address, type Hash, type Hex } from "viem";
import { erc20TradeAbi, publicClient } from "@/lib/contracts";
import { selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";
import { assertArcProtocolEconomicsReady } from "@/lib/arc-safety";
export const BASE_MAINNET_WETH = "0x4200000000000000000000000000000000000006" as const;
export const BASE_MAINNET_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as const;
export const BASE_MAINNET_QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const;
export const BASE_MAINNET_SWAP_ROUTER_02 = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
export const CANONICAL_POOL_FEE = 10_000;
export const QUOTE_TTL_MS = 60_000;

const selectedWeth = BASE_MAINNET_WETH;

/**
 * Uniswap swap-router-contracts Constants.CONTRACT_BALANCE.
 * Official source: https://github.com/Uniswap/swap-router-contracts/blob/main/contracts/libraries/Constants.sol
 * The deployed SwapRouter02 V3 code uses this exact zero value to consume the
 * router-held input-token balance and set the swap payer to address(this).
 */
export const CONTRACT_BALANCE = BigInt(0);

const poolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// IQuoterV2.quoteExactInputSingle(QuoteExactInputSingleParams): (uint256,uint160,uint32,uint256)
export const quoterV2Abi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "WETH9", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable", inputs: [{ type: "tuple", components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "fee", type: "uint24" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }], outputs: [{ name: "amountOut", type: "uint256" }, { name: "sqrtPriceX96After", type: "uint160" }, { name: "initializedTicksCrossed", type: "uint32" }, { name: "gasEstimate", type: "uint256" }] },
] as const;

// Official ISwapRouter02 / IV3SwapRouter ABI. Its ExactInputSingleParams deliberately has no deadline.
export const swapRouter02Abi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "WETH9", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "exactInputSingle", stateMutability: "payable", inputs: [{ type: "tuple", components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" }, { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "multicall", stateMutability: "payable", inputs: [{ name: "deadline", type: "uint256" }, { name: "data", type: "bytes[]" }], outputs: [{ type: "bytes[]" }] },
  { type: "function", name: "wrapETH", stateMutability: "payable", inputs: [{ name: "value", type: "uint256" }], outputs: [] },
  { type: "function", name: "unwrapWETH9", stateMutability: "payable", inputs: [{ name: "amountMinimum", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [] },
] as const;

export type UniswapV3Config = { quoter: Address; router: Address; factory: Address };
export type ValidatedPool = UniswapV3Config & { pool: Address; token: Address; token0: Address; token1: Address };
export type GraduatedQuote = { side: "buy" | "sell"; amountIn: bigint; amountOut: bigint; minimumOut: bigint; slippageBps: number; createdAt: number; deadline: bigint; pool: Address; wallet: Address; chainId: number };
export type GraduatedSwapTransaction = { to: Address; data: Hex; value: bigint };
export type GraduatedSwapSender = (transaction: GraduatedSwapTransaction) => Promise<Hash>;
export type GraduatedExecutionState = { eth: bigint; token: bigint; allowance: bigint };
export const GRADUATED_ALLOWANCE_POLL_DELAYS_MS = [0, 250, 500, 1_000, 1_500] as const;

/**
 * Some browser wallet providers expose a successful approval receipt before
 * their allowance read reflects the new state. Poll the authoritative chain
 * read before allowing the dependent swap to continue.
 */
export async function waitForGraduatedAllowance(readAllowance: () => Promise<bigint>, required: bigint, delays: readonly number[] = GRADUATED_ALLOWANCE_POLL_DELAYS_MS): Promise<bigint> {
  for (const delay of delays) {
    if (delay > 0) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delay));
    const allowance = await readAllowance();
    if (allowance >= required) return allowance;
  }
  throw new Error("Confirmed approval is still insufficient; swap was not submitted.");
}

/** Runs the single-click graduated flow after the component has selected its wallet transport. */
export async function orchestrateGraduatedSwap(input: {
  side: "buy" | "sell";
  amountIn: bigint;
  initialState: GraduatedExecutionState;
  readState: () => Promise<GraduatedExecutionState>;
  approve: () => Promise<void>;
  assertContext: () => void;
  buildTransaction: () => GraduatedSwapTransaction;
  simulate: (transaction: GraduatedSwapTransaction) => Promise<unknown>;
  send: (transaction: GraduatedSwapTransaction) => Promise<Hash>;
  allowanceDelays?: readonly number[];
}): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  input.assertContext();
  if (input.side === "buy" && input.initialState.eth < input.amountIn) throw new Error("Insufficient native USDC balance.");
  if (input.side === "sell" && input.initialState.token < input.amountIn) throw new Error("Insufficient token balance.");
  if (input.side === "sell" && input.initialState.allowance < input.amountIn) {
    await input.approve();
    await waitForGraduatedAllowance(async () => (await input.readState()).allowance, input.amountIn, input.allowanceDelays);
  }
  input.assertContext();
  const state = await input.readState();
  if (input.side === "buy" && state.eth < input.amountIn) throw new Error("The active wallet no longer has enough native USDC for this buy.");
  if (input.side === "sell" && state.allowance < input.amountIn) throw new Error("Confirmed approval is still insufficient; swap was not submitted.");
  if (input.side === "sell" && state.token < input.amountIn) throw new Error("The active wallet no longer has enough token balance for this sell.");
  input.assertContext();
  const transaction = input.buildTransaction();
  await input.simulate(transaction);
  input.assertContext();
  return input.send(transaction);
}

export function configuredUniswapV3(): UniswapV3Config | undefined {
  // Phase 0 has no approved Arc Testnet DEX, wrapped-native asset, quoter,
  // router, or factory. Base variables are deliberately ignored.
  return undefined;
}

export function minimumOutput(amountOut: bigint, slippageBps: number): bigint {
  if (amountOut <= BigInt(0)) throw new Error("Quoted output must be greater than zero.");
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 2_000) throw new Error("Slippage must be between 0.01% and 20%.");
  return amountOut * BigInt(10_000 - slippageBps) / BigInt(10_000);
}

export function quoteIsFresh(quote: GraduatedQuote, wallet: Address, pool: Address, chainId: number, now = Date.now()): boolean {
  return quote.wallet.toLowerCase() === wallet.toLowerCase() && quote.pool.toLowerCase() === pool.toLowerCase() && quote.chainId === chainId && now - quote.createdAt < QUOTE_TTL_MS && BigInt(Math.floor(now / 1000)) < quote.deadline;
}

export async function validateCanonicalPool(pool: Address, token: Address): Promise<ValidatedPool> {
  const config = configuredUniswapV3();
  if (!config) throw new Error(`Uniswap V3 configuration is unavailable for ${selectedCooketChainName}.`);
  const [poolCode, quoterCode, routerCode, factoryCode, wethCode] = await Promise.all([pool, config.quoter, config.router, config.factory, selectedWeth].map((address) => publicClient.getBytecode({ address })));
  if (!poolCode || poolCode === "0x") throw new Error(`The indexed canonical pool has no deployed bytecode on ${selectedCooketChainName}.`);
  if (!quoterCode || quoterCode === "0x") throw new Error(`Configured QuoterV2 has no deployed bytecode on ${selectedCooketChainName}.`);
  if (!routerCode || routerCode === "0x") throw new Error(`Configured SwapRouter02 has no deployed bytecode on ${selectedCooketChainName}.`);
  if (!factoryCode || factoryCode === "0x" || !wethCode || wethCode === "0x") throw new Error(`Configured canonical Uniswap dependency has no deployed bytecode on ${selectedCooketChainName}.`);
  const [token0, token1, fee, factory, quoterFactory, quoterWeth, routerFactory, routerWeth] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }), publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token1" }), publicClient.readContract({ address: pool, abi: poolAbi, functionName: "fee" }), publicClient.readContract({ address: pool, abi: poolAbi, functionName: "factory" }),
    publicClient.readContract({ address: config.quoter, abi: quoterV2Abi, functionName: "factory" }), publicClient.readContract({ address: config.quoter, abi: quoterV2Abi, functionName: "WETH9" }), publicClient.readContract({ address: config.router, abi: swapRouter02Abi, functionName: "factory" }), publicClient.readContract({ address: config.router, abi: swapRouter02Abi, functionName: "WETH9" }),
  ]);
  const pair = new Set([getAddress(token0).toLowerCase(), getAddress(token1).toLowerCase()]);
  if (pair.size !== 2 || !pair.has(selectedWeth.toLowerCase()) || !pair.has(getAddress(token).toLowerCase())) throw new Error("The canonical pool token pair is not exactly WETH and this graduated token.");
  if (fee !== CANONICAL_POOL_FEE) throw new Error("The canonical pool must use the 1% Uniswap V3 fee tier.");
  for (const address of [factory, quoterFactory, routerFactory]) if (getAddress(address).toLowerCase() !== config.factory.toLowerCase()) throw new Error("The pool or configured periphery is not linked to the selected chain's canonical Uniswap V3 factory.");
  for (const address of [quoterWeth, routerWeth]) if (getAddress(address).toLowerCase() !== selectedWeth.toLowerCase()) throw new Error(`Configured periphery is not linked to ${selectedCooketChainName} WETH.`);
  return { ...config, pool: getAddress(pool), token: getAddress(token), token0: getAddress(token0), token1: getAddress(token1) };
}

export async function quoteGraduatedSwap(pool: ValidatedPool, side: "buy" | "sell", amountIn: bigint, slippageBps: number, wallet: Address): Promise<GraduatedQuote> {
  if (amountIn <= BigInt(0)) throw new Error("Enter an amount greater than zero.");
  const tokenIn = side === "buy" ? selectedWeth : pool.token;
  const tokenOut = side === "buy" ? pool.token : selectedWeth;
  const result = await publicClient.readContract({ address: pool.quoter, abi: quoterV2Abi as never, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee: CANONICAL_POOL_FEE, sqrtPriceLimitX96: BigInt(0) }] } as never) as unknown as readonly [bigint];
  const amountOut: bigint = result[0];
  const now = Date.now();
  return { side, amountIn, amountOut, minimumOut: minimumOutput(amountOut, slippageBps), slippageBps, createdAt: now, deadline: BigInt(Math.floor(now / 1000) + 300), pool: pool.pool, wallet, chainId: selectedCooketChainId };
}

/** Builds the sole payload used for raw simulation and both wallet transports. */
export function buildGraduatedSwapTransaction(pool: ValidatedPool, quote: GraduatedQuote, recipient: Address): GraduatedSwapTransaction {
  const params = { tokenIn: quote.side === "buy" ? selectedWeth : pool.token, tokenOut: quote.side === "buy" ? pool.token : selectedWeth, fee: CANONICAL_POOL_FEE, recipient: quote.side === "buy" ? recipient : pool.router, amountIn: quote.side === "buy" ? CONTRACT_BALANCE : quote.amountIn, amountOutMinimum: quote.minimumOut, sqrtPriceLimitX96: BigInt(0) };
  if (quote.side === "buy") {
    // SwapRouter02 does not implicitly wrap msg.value for exactInputSingle.
    // Wrap into router-held WETH, then swap it to the active wallet.
    const wrap = encodeFunctionData({ abi: swapRouter02Abi, functionName: "wrapETH", args: [quote.amountIn] });
    const swap = encodeFunctionData({ abi: swapRouter02Abi, functionName: "exactInputSingle", args: [params] });
    return { to: pool.router, data: encodeFunctionData({ abi: swapRouter02Abi, functionName: "multicall", args: [quote.deadline, [wrap, swap]] }), value: quote.amountIn };
  }
  const exactInput = encodeFunctionData({ abi: swapRouter02Abi, functionName: "exactInputSingle", args: [params] });
  const unwrap = encodeFunctionData({ abi: swapRouter02Abi, functionName: "unwrapWETH9", args: [quote.minimumOut, recipient] });
  return { to: pool.router, data: encodeFunctionData({ abi: swapRouter02Abi, functionName: "multicall", args: [quote.deadline, [exactInput, unwrap]] }), value: BigInt(0) };
}

/** Simulates the exact canonical {to, data, value} payload sent by either wallet transport. */
export function simulateGraduatedSwapTransaction(transaction: GraduatedSwapTransaction, account: Address) {
  return publicClient.call({ account, ...transaction });
}

export function approvalCall(token: Address, spender: Address, amount: bigint): GraduatedSwapTransaction {
  if (amount <= BigInt(0)) throw new Error("Approval amount must be greater than zero.");
  return { to: token, data: encodeFunctionData({ abi: erc20TradeAbi, functionName: "approve", args: [spender, amount] }), value: BigInt(0) };
}
