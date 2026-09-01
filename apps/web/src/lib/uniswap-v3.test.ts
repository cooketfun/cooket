import { decodeFunctionData, getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_MAINNET_QUOTER_V2, BASE_MAINNET_SWAP_ROUTER_02, BASE_MAINNET_V3_FACTORY, BASE_MAINNET_WETH, CANONICAL_POOL_FEE, CONTRACT_BALANCE, approvalCall, buildGraduatedSwapTransaction, configuredUniswapV3, minimumOutput, orchestrateGraduatedSwap, quoteIsFresh, simulateGraduatedSwapTransaction, swapRouter02Abi, validateCanonicalPool, waitForGraduatedAllowance, type GraduatedQuote, type ValidatedPool } from "./uniswap-v3";
import { erc20TradeAbi, publicClient } from "@/lib/contracts";
import { ARC_PROTOCOL_ECONOMICS_BLOCKER } from "./arc-safety";

const token = "0x0000000000000000000000000000000000000011" as const;
const wallet = "0x0000000000000000000000000000000000000022" as const;
const pool: ValidatedPool = { pool: "0x0000000000000000000000000000000000000033", token, token0: BASE_MAINNET_WETH, token1: token, quoter: "0x0000000000000000000000000000000000000044", router: "0x0000000000000000000000000000000000000055", factory: "0x0000000000000000000000000000000000000066" };
const quote = (side: "buy" | "sell"): GraduatedQuote => ({ side, amountIn: BigInt(1000), amountOut: BigInt(900), minimumOut: BigInt(895), slippageBps: 50, createdAt: 1_000, deadline: BigInt(2_000), pool: pool.pool, wallet, chainId: 5042002 });

describe("graduated Uniswap V3 SwapRouter02 guardrails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ["NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_QUOTER_V2", "NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_SWAP_ROUTER_02", "NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_FACTORY"]) delete process.env[key];
  });

  it("uses the official SwapRouter02 CONTRACT_BALANCE sentinel", () => {
    expect(CONTRACT_BALANCE).toBe(BigInt(0));
  });

  it("defines the canonical Base Mainnet Uniswap V3 dependencies", () => {
    expect(BASE_MAINNET_WETH).toBe("0x4200000000000000000000000000000000000006");
    expect(BASE_MAINNET_V3_FACTORY).toBe("0x33128a8fC17869897dcE68Ed026d694621f6FDfD");
    expect(BASE_MAINNET_QUOTER_V2).toBe("0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a");
    expect(BASE_MAINNET_SWAP_ROUTER_02).toBe("0x2626664c2603336E57B271c5C0b26F421741e481");
  });

  it("protects quoted output with integer slippage and rejects invalid inputs", () => {
    expect(minimumOutput(BigInt(1001), 50)).toBe(BigInt(995));
    expect(() => minimumOutput(BigInt(1), 0)).toThrow(/slippage/i);
    expect(() => minimumOutput(BigInt(0), 50)).toThrow(/output/i);
  });
  it("rejects stale, wallet-changed, chain-changed, and pool-changed quote contexts", () => {
    expect(quoteIsFresh(quote("buy"), wallet, pool.pool, 5042002, 1_500)).toBe(true);
    expect(quoteIsFresh(quote("buy"), wallet, pool.pool, 1, 1_500)).toBe(false);
    expect(quoteIsFresh(quote("buy"), "0x0000000000000000000000000000000000000023", pool.pool, 5042002, 1_500)).toBe(false);
    expect(quoteIsFresh(quote("buy"), wallet, "0x0000000000000000000000000000000000000034", 5042002, 1_500)).toBe(false);
    expect(quoteIsFresh(quote("buy"), wallet, pool.pool, 5042002, 62_000)).toBe(false);
  });
  it("encodes the SwapRouter02 buy payload with explicit wrap then swap", () => {
    const transaction = buildGraduatedSwapTransaction(pool, quote("buy"), wallet);
    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data: transaction.data });
    expect(transaction.to).toBe(pool.router);
    expect(transaction.value).toBe(BigInt(1000));
    expect(decoded.functionName).toBe("multicall");
    const calls = decoded.args?.[1] as readonly `0x${string}`[];
    const wrap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[0] });
    const swap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[1] });
    expect(wrap.functionName).toBe("wrapETH");
    expect(wrap.args).toEqual([BigInt(1000)]);
    const params = swap.args?.[0] as { tokenIn: string; tokenOut: string; fee: number; recipient: string; amountIn: bigint };
    expect(getAddress(params.tokenIn)).toBe(BASE_MAINNET_WETH);
    expect(getAddress(params.tokenOut)).toBe(token);
    expect(params.fee).toBe(CANONICAL_POOL_FEE);
    expect(getAddress(params.recipient)).toBe(wallet);
    expect(params.amountIn).toBe(CONTRACT_BALANCE);
  });
  it("encodes the complete sell multicall: token to router then minimum-safe WETH unwrap to wallet", () => {
    const transaction = buildGraduatedSwapTransaction(pool, quote("sell"), wallet);
    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data: transaction.data });
    expect(transaction.value).toBe(BigInt(0));
    expect(decoded.functionName).toBe("multicall");
    const calls = decoded.args?.[1] as readonly `0x${string}`[];
    const swap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[0] });
    const unwrap = decodeFunctionData({ abi: swapRouter02Abi, data: calls[1] });
    const params = swap.args?.[0] as { tokenIn: string; tokenOut: string; recipient: string; amountIn: bigint; fee: number };
    expect(swap.functionName).toBe("exactInputSingle");
    expect(getAddress(params.tokenIn)).toBe(token);
    expect(getAddress(params.tokenOut)).toBe(BASE_MAINNET_WETH);
    expect(getAddress(params.recipient)).toBe(pool.router);
    expect(params.amountIn).toBe(BigInt(1000));
    expect(params.amountIn).not.toBe(CONTRACT_BALANCE);
    expect(params.fee).toBe(CANONICAL_POOL_FEE);
    expect(unwrap.functionName).toBe("unwrapWETH9");
    expect(unwrap.args).toEqual([BigInt(895), wallet]);
  });

  it.each(["buy", "sell"] as const)("passes the same canonical %s {to,data,value} to raw simulation and submission", async (side) => {
    const transaction = buildGraduatedSwapTransaction(pool, quote(side), wallet);
    const call = vi.spyOn(publicClient, "call").mockResolvedValue("0x" as never);
    const submitted = vi.fn().mockResolvedValue(`0x${"ab".repeat(32)}` as const);
    await simulateGraduatedSwapTransaction(transaction, wallet);
    await submitted(transaction);
    expect(call).toHaveBeenCalledWith({ account: wallet, ...transaction });
    expect(submitted).toHaveBeenCalledWith(transaction);
    expect(submitted.mock.calls[0][0]).toBe(transaction);
    expect(transaction).toEqual({ to: pool.router, data: expect.any(String), value: side === "buy" ? BigInt(1000) : BigInt(0) });
  });

  it("fails closed when any periphery address is missing", () => {
    process.env.NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_QUOTER_V2 = BASE_MAINNET_QUOTER_V2;
    process.env.NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_SWAP_ROUTER_02 = BASE_MAINNET_SWAP_ROUTER_02;
    expect(configuredUniswapV3()).toBeUndefined();
  });

  async function expectArcDexUnavailable() {
    process.env.NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_QUOTER_V2 = BASE_MAINNET_QUOTER_V2;
    process.env.NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_SWAP_ROUTER_02 = BASE_MAINNET_SWAP_ROUTER_02;
    process.env.NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_FACTORY = BASE_MAINNET_V3_FACTORY;
    vi.spyOn(publicClient, "getBytecode").mockResolvedValue("0x6000" as never);
    await expect(validateCanonicalPool(pool.pool, token)).rejects.toThrow(/unavailable.*Arc Testnet/i);
    expect(publicClient.getBytecode).not.toHaveBeenCalled();
  }

  it("rejects every inherited Base periphery configuration before an RPC call", expectArcDexUnavailable);

  it("encodes an exact positive sell approval amount", () => {
    const approval = approvalCall(token, pool.router, BigInt(1000));
    expect(decodeFunctionData({ abi: erc20TradeAbi, data: approval.data })).toEqual({ functionName: "approve", args: [pool.router, BigInt(1000)] });
  });

  it("rereads a lagging allowance after the approval receipt before continuing", async () => {
    const reads = vi.fn().mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(BigInt(999)).mockResolvedValueOnce(BigInt(1000));
    await expect(waitForGraduatedAllowance(reads, BigInt(1000), [0, 0, 0])).resolves.toBe(BigInt(1000));
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it("fails closed when the confirmed approval never becomes sufficient", async () => {
    const reads = vi.fn().mockResolvedValue(BigInt(999));
    await expect(waitForGraduatedAllowance(reads, BigInt(1000), [0, 0])).rejects.toThrow(/insufficient/i);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("blocks inherited Base DEX execution before approval, simulation, or submission", async () => {
    const state = { eth: BigInt(1000), token: BigInt(1000), allowance: BigInt(1000) };
    const transaction = buildGraduatedSwapTransaction(pool, quote("sell"), wallet);
    const readState = vi.fn().mockResolvedValue(state);
    const approve = vi.fn().mockResolvedValue(undefined);
    const assertContext = vi.fn();
    const simulate = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(`0x${"cd".repeat(32)}` as const);
    await expect(orchestrateGraduatedSwap({ side: "sell", amountIn: BigInt(1000), initialState: state, readState, approve, assertContext, buildTransaction: () => transaction, simulate, send, allowanceDelays: [0] })).rejects.toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
    expect(assertContext).not.toHaveBeenCalled();
    expect(readState).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
