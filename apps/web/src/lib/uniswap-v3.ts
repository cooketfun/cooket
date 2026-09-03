import { encodeFunctionData, getAddress, type Address, type Hash, type Hex } from "viem";
import { ARC_CANONICAL_USDC } from "@cooket/contracts-sdk";
import { erc20TradeAbi, publicClient } from "@/lib/contracts";
import { selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";
import { assertArcProtocolEconomicsReady } from "@/lib/arc-safety";
export const CANONICAL_POOL_FEE = 10_000;
export const QUOTE_TTL_MS = 60_000;
export const ARC_TESTNET_V3_FACTORY = "0xc70593E016A5d50451b1A2Cf3173E7d77F120B37" as const;

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

// Official Uniswap/v3-periphery ISwapRouter ABI (commit 06823871).
export const swapRouterAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "WETH9", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "exactInputSingle", stateMutability: "payable", inputs: [{ type: "tuple", components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" }, { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }], outputs: [{ type: "uint256" }] },
] as const;

export type UniswapV3Config = { quoter: Address; router: Address; factory: Address };
export type ValidatedPool = UniswapV3Config & { pool: Address; token: Address; token0: Address; token1: Address };
export type GraduatedQuote = { side: "buy" | "sell"; amountIn: bigint; amountOut: bigint; minimumOut: bigint; slippageBps: number; createdAt: number; deadline: bigint; pool: Address; wallet: Address; chainId: number };
export type GraduatedSwapTransaction = { to: Address; data: Hex; value: bigint };
export type GraduatedSwapSender = (transaction: GraduatedSwapTransaction) => Promise<Hash>;
export type GraduatedExecutionState = { usdc: bigint; token: bigint; allowance: bigint };
export type GraduatedSwapState = GraduatedExecutionState;
export const GRADUATED_ALLOWANCE_POLL_DELAYS_MS = [0, 250, 500, 1_000, 1_500] as const;
export const GRADUATED_SWAP_SIMULATION_TIMEOUT_MS = 15_000;
export const GRADUATED_SWAP_RPC_TIMEOUT_MS = 15_000;

export class GraduatedSwapSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraduatedSwapSimulationError";
  }
}

export class GraduatedSwapSimulationTimeoutError extends GraduatedSwapSimulationError {
  constructor(timeoutMs: number) {
    super(`Swap simulation timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = "GraduatedSwapSimulationTimeoutError";
  }
}

export class GraduatedSwapRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraduatedSwapRpcError";
  }
}

export class GraduatedSwapRpcTimeoutError extends GraduatedSwapRpcError {
  constructor(timeoutMs: number, operation = "RPC request") {
    super(`${operation} timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = "GraduatedSwapRpcTimeoutError";
  }
}

function simulationFailure(reason: unknown): GraduatedSwapSimulationError {
  if (reason instanceof GraduatedSwapSimulationError) return reason;
  return new GraduatedSwapSimulationError(reason instanceof Error ? reason.message : String(reason));
}

async function withAbortableTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, timeoutError: () => Error, invalidMessage: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(invalidMessage);
  const controller = new AbortController();
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const pending = run(controller.signal);
  void pending.catch(() => undefined);
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timeout = globalThis.setTimeout(() => {
          controller.abort();
          reject(timeoutError());
        }, timeoutMs);
      }),
    ]);
  } catch (reason) {
    if (controller.signal.aborted) throw timeoutError();
    throw reason;
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

export async function withGraduatedRpcTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs = GRADUATED_SWAP_RPC_TIMEOUT_MS, operation = "RPC request"): Promise<T> {
  try {
    return await withAbortableTimeout(run, timeoutMs, () => new GraduatedSwapRpcTimeoutError(timeoutMs, operation), "Swap RPC timeout must be positive.");
  } catch (reason) {
    if (reason instanceof GraduatedSwapRpcTimeoutError) throw reason;
    throw new GraduatedSwapRpcError(reason instanceof Error ? reason.message : String(reason));
  }
}

/**
 * Some browser wallet providers expose a successful approval receipt before
 * their allowance read reflects the new state. Poll the authoritative chain
 * read before allowing the dependent swap to continue.
 */
export async function waitForGraduatedAllowance(readAllowance: () => Promise<bigint>, required: bigint, delays: readonly number[] = GRADUATED_ALLOWANCE_POLL_DELAYS_MS, timeoutMs = GRADUATED_SWAP_RPC_TIMEOUT_MS): Promise<bigint> {
  for (const delay of delays) {
    if (delay > 0) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delay));
    const allowance = await withGraduatedRpcTimeout(() => readAllowance(), timeoutMs, "Refreshing token allowance");
    if (allowance >= required) return allowance;
  }
  throw new Error("Confirmed approval is still insufficient; swap was not submitted.");
}

export async function readGraduatedTokenDecimals(token: Address, timeoutMs = GRADUATED_SWAP_RPC_TIMEOUT_MS): Promise<number> {
  return withGraduatedRpcTimeout(async (signal) => {
    return publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "decimals", requestOptions: { signal, retryCount: 0 } } as never) as Promise<number>;
  }, timeoutMs, "Reading token decimals");
}

export async function readGraduatedAllowance(token: Address, wallet: Address, router: Address, side: "buy" | "sell", timeoutMs = GRADUATED_SWAP_RPC_TIMEOUT_MS): Promise<bigint> {
  const inputToken = side === "buy" ? ARC_CANONICAL_USDC : token;
  return withGraduatedRpcTimeout(async (signal) => {
    return publicClient.readContract({ address: inputToken, abi: erc20TradeAbi, functionName: "allowance", args: [wallet, router], requestOptions: { signal, retryCount: 0 } } as never) as Promise<bigint>;
  }, timeoutMs, "Refreshing token allowance");
}

export async function readGraduatedSwapState(token: Address, wallet: Address, router: Address, side: "buy" | "sell", timeoutMs = GRADUATED_SWAP_RPC_TIMEOUT_MS): Promise<GraduatedSwapState> {
  const inputToken = side === "buy" ? ARC_CANONICAL_USDC : token;
  return withGraduatedRpcTimeout(async (signal) => {
    const requestOptions = { signal, retryCount: 0 };
    const [usdc, tokenBalance, allowance] = await Promise.all([
      publicClient.readContract({ address: ARC_CANONICAL_USDC, abi: erc20TradeAbi, functionName: "balanceOf", args: [wallet], requestOptions } as never),
      publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "balanceOf", args: [wallet], requestOptions } as never),
      publicClient.readContract({ address: inputToken, abi: erc20TradeAbi, functionName: "allowance", args: [wallet, router], requestOptions } as never),
    ]) as [bigint, bigint, bigint];
    return { usdc, token: tokenBalance, allowance };
  }, timeoutMs, "Refreshing swap balances and allowance");
}

/** Runs the single-click graduated flow after the component has selected its wallet transport. */
export async function orchestrateGraduatedSwap(input: {
  side: "buy" | "sell";
  amountIn: bigint;
  initialState: GraduatedExecutionState;
  readAllowance: () => Promise<bigint>;
  approve: () => Promise<void>;
  assertContext: () => void;
  buildTransaction: () => GraduatedSwapTransaction;
  send: (transaction: GraduatedSwapTransaction) => Promise<Hash>;
  allowanceDelays?: readonly number[];
  rpcTimeoutMs?: number;
}): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  const rpcTimeoutMs = input.rpcTimeoutMs ?? GRADUATED_SWAP_RPC_TIMEOUT_MS;
  input.assertContext();
  if (input.side === "buy" && input.initialState.usdc < input.amountIn) throw new Error("Insufficient canonical ERC20 USDC balance.");
  if (input.side === "sell" && input.initialState.token < input.amountIn) throw new Error("Insufficient token balance.");
  if (input.initialState.allowance < input.amountIn) {
    await input.approve();
    await waitForGraduatedAllowance(input.readAllowance, input.amountIn, input.allowanceDelays, rpcTimeoutMs);
  }
  input.assertContext();
  return input.send(input.buildTransaction());
}

export function configuredUniswapV3(): UniswapV3Config | undefined {
  const values = [
    process.env.NEXT_PUBLIC_ARC_TESTNET_UNISWAP_V3_QUOTER_V2,
    process.env.NEXT_PUBLIC_ARC_TESTNET_UNISWAP_V3_SWAP_ROUTER,
    process.env.NEXT_PUBLIC_ARC_TESTNET_UNISWAP_V3_FACTORY,
    process.env.NEXT_PUBLIC_ARC_TESTNET_CANONICAL_USDC,
  ].map((value) => value?.trim());
  if (values.every((value) => !value)) return undefined;
  if (values.some((value) => !value || !/^0x[0-9a-fA-F]{40}$/.test(value))) throw new Error("Arc Testnet Uniswap configuration is incomplete or invalid.");
  const [quoter, router, factory, usdc] = values.map((value) => getAddress(value!));
  if (usdc !== getAddress(ARC_CANONICAL_USDC)) throw new Error("Arc Testnet canonical USDC configuration mismatch.");
  if (factory !== getAddress(ARC_TESTNET_V3_FACTORY)) throw new Error("Arc Testnet Uniswap factory configuration mismatch.");
  if (new Set([quoter, router, factory, usdc].map((address) => address.toLowerCase())).size !== 4) throw new Error("Arc Testnet Uniswap addresses must be distinct.");
  return { quoter, router, factory };
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
  const [poolCode, quoterCode, routerCode, factoryCode, usdcCode] = await Promise.all([pool, config.quoter, config.router, config.factory, ARC_CANONICAL_USDC].map((address) => publicClient.getBytecode({ address })));
  if (!poolCode || poolCode === "0x") throw new Error(`The indexed canonical pool has no deployed bytecode on ${selectedCooketChainName}.`);
  if (!quoterCode || quoterCode === "0x") throw new Error(`Configured QuoterV2 has no deployed bytecode on ${selectedCooketChainName}.`);
  if (!routerCode || routerCode === "0x") throw new Error(`Configured SwapRouter has no deployed bytecode on ${selectedCooketChainName}.`);
  if (!factoryCode || factoryCode === "0x" || !usdcCode || usdcCode === "0x") throw new Error(`Configured canonical Uniswap dependency has no deployed bytecode on ${selectedCooketChainName}.`);
  const [token0, token1, fee, factory, quoterFactory, quoterWeth, routerFactory, routerWeth] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }), publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token1" }), publicClient.readContract({ address: pool, abi: poolAbi, functionName: "fee" }), publicClient.readContract({ address: pool, abi: poolAbi, functionName: "factory" }),
    publicClient.readContract({ address: config.quoter, abi: quoterV2Abi, functionName: "factory" }), publicClient.readContract({ address: config.quoter, abi: quoterV2Abi, functionName: "WETH9" }), publicClient.readContract({ address: config.router, abi: swapRouterAbi, functionName: "factory" }), publicClient.readContract({ address: config.router, abi: swapRouterAbi, functionName: "WETH9" }),
  ]);
  const pair = new Set([getAddress(token0).toLowerCase(), getAddress(token1).toLowerCase()]);
  if (pair.size !== 2 || !pair.has(ARC_CANONICAL_USDC.toLowerCase()) || !pair.has(getAddress(token).toLowerCase())) throw new Error("The canonical pool pair is not exactly ERC20 USDC and this graduated token.");
  if (fee !== CANONICAL_POOL_FEE) throw new Error("The canonical pool must use the 1% Uniswap V3 fee tier.");
  for (const address of [factory, quoterFactory, routerFactory]) if (getAddress(address).toLowerCase() !== config.factory.toLowerCase()) throw new Error("The pool or configured periphery is not linked to the selected chain's canonical Uniswap V3 factory.");
  if (getAddress(quoterWeth) !== getAddress(routerWeth) || getAddress(quoterWeth) === getAddress(ARC_CANONICAL_USDC)) throw new Error("Configured periphery does not share the UnsupportedProtocol no-WETH marker.");
  return { ...config, pool: getAddress(pool), token: getAddress(token), token0: getAddress(token0), token1: getAddress(token1) };
}

export async function quoteGraduatedSwap(pool: ValidatedPool, side: "buy" | "sell", amountIn: bigint, slippageBps: number, wallet: Address): Promise<GraduatedQuote> {
  if (amountIn <= BigInt(0)) throw new Error("Enter an amount greater than zero.");
  const tokenIn = side === "buy" ? ARC_CANONICAL_USDC : pool.token;
  const tokenOut = side === "buy" ? pool.token : ARC_CANONICAL_USDC;
  const result = await withGraduatedRpcTimeout((signal) => publicClient.readContract({ address: pool.quoter, abi: quoterV2Abi as never, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee: CANONICAL_POOL_FEE, sqrtPriceLimitX96: BigInt(0) }], requestOptions: { signal, retryCount: 0 } } as never), GRADUATED_SWAP_RPC_TIMEOUT_MS, "Swap quote") as unknown as readonly [bigint];
  const amountOut: bigint = result[0];
  const now = Date.now();
  return { side, amountIn, amountOut, minimumOut: minimumOutput(amountOut, slippageBps), slippageBps, createdAt: now, deadline: BigInt(Math.floor(now / 1000) + 300), pool: pool.pool, wallet, chainId: selectedCooketChainId };
}

/** Builds the sole payload used for raw simulation and both wallet transports. */
export function buildGraduatedSwapTransaction(pool: ValidatedPool, quote: GraduatedQuote, recipient: Address): GraduatedSwapTransaction {
  const params = { tokenIn: quote.side === "buy" ? ARC_CANONICAL_USDC : pool.token, tokenOut: quote.side === "buy" ? pool.token : ARC_CANONICAL_USDC, fee: CANONICAL_POOL_FEE, recipient, deadline: quote.deadline, amountIn: quote.amountIn, amountOutMinimum: quote.minimumOut, sqrtPriceLimitX96: BigInt(0) };
  return { to: pool.router, data: encodeFunctionData({ abi: swapRouterAbi, functionName: "exactInputSingle", args: [params] }), value: BigInt(0) };
}

/** Optional diagnostic eth_call. Must never gate wallet submission. */
export async function simulateGraduatedSwapTransaction(transaction: GraduatedSwapTransaction, account: Address, timeoutMs = GRADUATED_SWAP_SIMULATION_TIMEOUT_MS) {
  try {
    return await withAbortableTimeout((signal) => publicClient.call({ account, ...transaction, requestOptions: { signal, retryCount: 0 } }), timeoutMs, () => new GraduatedSwapSimulationTimeoutError(timeoutMs), "Swap simulation timeout must be positive.");
  } catch (reason) {
    if (reason instanceof GraduatedSwapSimulationTimeoutError) throw reason;
    throw simulationFailure(reason);
  }
}

export function approvalCall(token: Address, spender: Address, amount: bigint): GraduatedSwapTransaction {
  if (amount <= BigInt(0)) throw new Error("Approval amount must be greater than zero.");
  return { to: token, data: encodeFunctionData({ abi: erc20TradeAbi, functionName: "approve", args: [spender, amount] }), value: BigInt(0) };
}
