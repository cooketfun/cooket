import { decodeFunctionData, getAddress, type Hash } from "viem";
import { ARC_CANONICAL_USDC } from "@cooket/contracts-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_POOL_FEE, GRADUATED_SWAP_SIMULATION_TIMEOUT_MS, GraduatedSwapSimulationError, GraduatedSwapSimulationTimeoutError, approvalCall, buildGraduatedSwapTransaction, configuredUniswapV3, minimumOutput, orchestrateGraduatedSwap, quoteIsFresh, simulateGraduatedSwapTransaction, simulateThenSendGraduatedSwap, swapRouterAbi, type GraduatedQuote, type ValidatedPool } from "./uniswap-v3";
import { erc20TradeAbi, publicClient } from "@/lib/contracts";
import { ARC_PROTOCOL_ECONOMICS_BLOCKER } from "./arc-safety";

const token = "0x0000000000000000000000000000000000000011" as const;
const wallet = "0x0000000000000000000000000000000000000022" as const;
const pool: ValidatedPool = { pool: "0x0000000000000000000000000000000000000033", token, token0: ARC_CANONICAL_USDC, token1: token, quoter: "0x0000000000000000000000000000000000000044", router: "0x0000000000000000000000000000000000000055", factory: "0xc70593E016A5d50451b1A2Cf3173E7d77F120B37" };
const quote = (side: "buy" | "sell"): GraduatedQuote => ({ side, amountIn: BigInt(1000), amountOut: BigInt(900), minimumOut: BigInt(895), slippageBps: 50, createdAt: 1_000, deadline: BigInt(2_000), pool: pool.pool, wallet, chainId: 5042002 });

describe("graduated Arc Uniswap V3 guardrails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("protects output and quote context", () => {
    expect(minimumOutput(BigInt(1001), 50)).toBe(BigInt(995));
    expect(() => minimumOutput(BigInt(1), 0)).toThrow(/slippage/i);
    expect(quoteIsFresh(quote("buy"), wallet, pool.pool, 5042002, 1_500)).toBe(true);
    expect(quoteIsFresh(quote("buy"), wallet, pool.pool, 1, 1_500)).toBe(false);
  });

  it.each(["buy", "sell"] as const)("encodes an ERC20-only SwapRouter %s", (side) => {
    const transaction = buildGraduatedSwapTransaction(pool, quote(side), wallet);
    const decoded = decodeFunctionData({ abi: swapRouterAbi, data: transaction.data });
    const params = decoded.args?.[0] as { tokenIn: string; tokenOut: string; recipient: string; deadline: bigint; amountIn: bigint };
    expect(transaction).toMatchObject({ to: pool.router, value: BigInt(0) });
    expect(decoded.functionName).toBe("exactInputSingle");
    expect(getAddress(params.tokenIn)).toBe(side === "buy" ? ARC_CANONICAL_USDC : token);
    expect(getAddress(params.tokenOut)).toBe(side === "buy" ? token : ARC_CANONICAL_USDC);
    expect(getAddress(params.recipient)).toBe(wallet);
    expect(params.deadline).toBe(BigInt(2_000));
    expect(params.amountIn).toBe(BigInt(1_000));
  });

  it("requires a complete Arc-only periphery configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_TESTNET_UNISWAP_V3_QUOTER_V2", pool.quoter);
    expect(() => configuredUniswapV3()).toThrow(/incomplete/i);
    vi.stubEnv("NEXT_PUBLIC_ARC_TESTNET_UNISWAP_V3_SWAP_ROUTER", pool.router);
    vi.stubEnv("NEXT_PUBLIC_ARC_TESTNET_UNISWAP_V3_FACTORY", pool.factory);
    vi.stubEnv("NEXT_PUBLIC_ARC_TESTNET_CANONICAL_USDC", ARC_CANONICAL_USDC);
    expect(configuredUniswapV3()).toEqual({ quoter: pool.quoter, router: pool.router, factory: pool.factory });
  });

  it("encodes exact approvals for USDC buys and token sells", () => {
    for (const input of [ARC_CANONICAL_USDC, token]) {
      const approval = approvalCall(input, pool.router, BigInt(1000));
      expect(decodeFunctionData({ abi: erc20TradeAbi, data: approval.data })).toEqual({ functionName: "approve", args: [pool.router, BigInt(1000)] });
    }
  });

  it("retains the economic release gate before approval or submission", async () => {
    const state = { usdc: BigInt(1000), token: BigInt(1000), allowance: BigInt(0) };
    const approve = vi.fn();
    const send = vi.fn();
    await expect(orchestrateGraduatedSwap({ side: "buy", amountIn: BigInt(1000), initialState: state, readState: vi.fn().mockResolvedValue({ ...state, allowance: BigInt(1000) }), approve, assertContext: vi.fn(), buildTransaction: () => buildGraduatedSwapTransaction(pool, quote("buy"), wallet), simulate: vi.fn(), send, allowanceDelays: [0] })).rejects.toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
    expect(approve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("pins the 1% canonical pool tier", () => expect(CANONICAL_POOL_FEE).toBe(10_000));
});

describe("graduated swap simulation preflight", () => {
  const hash = `0x${"ab".repeat(32)}` as Hash;
  const transaction = buildGraduatedSwapTransaction(pool, quote("buy"), wallet);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("bounds the eth_call timeout", () => {
    expect(GRADUATED_SWAP_SIMULATION_TIMEOUT_MS).toBe(15_000);
  });

  it.each(["buy", "sell"] as const)("simulates the exact %s router payload then sends it", async (side) => {
    const payload = buildGraduatedSwapTransaction(pool, quote(side), wallet);
    const call = vi.spyOn(publicClient, "call").mockResolvedValue({ data: "0x" });
    const send = vi.fn().mockResolvedValue(hash);
    const assertContext = vi.fn();
    await expect(simulateThenSendGraduatedSwap(payload, (value) => simulateGraduatedSwapTransaction(value, wallet), assertContext, send)).resolves.toBe(hash);
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]?.[0]).toMatchObject({ account: wallet, to: payload.to, data: payload.data, value: payload.value });
    expect(assertContext).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(payload);
    expect(call.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
  });

  it("wraps an eth_call revert as a simulation failure and does not send", async () => {
    vi.spyOn(publicClient, "call").mockRejectedValue(new Error("execution reverted: STF"));
    const send = vi.fn();
    await expect(simulateThenSendGraduatedSwap(transaction, (value) => simulateGraduatedSwapTransaction(value, wallet), vi.fn(), send)).rejects.toSatisfy((reason: unknown) => reason instanceof GraduatedSwapSimulationError && /execution reverted/i.test((reason as Error).message) && !(reason instanceof GraduatedSwapSimulationTimeoutError));
    expect(send).not.toHaveBeenCalled();
  });

  it("times out a hanging eth_call, aborts it, and does not send", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(publicClient, "call").mockImplementation((request) => {
      signal = request.requestOptions?.signal;
      return new Promise(() => undefined);
    });
    const send = vi.fn();
    const pending = simulateThenSendGraduatedSwap(transaction, (value) => simulateGraduatedSwapTransaction(value, wallet, 25), vi.fn(), send);
    await expect(pending).rejects.toBeInstanceOf(GraduatedSwapSimulationTimeoutError);
    expect(signal?.aborted).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send after an RPC simulation failure", async () => {
    vi.spyOn(publicClient, "call").mockRejectedValue(new Error("HTTP request failed."));
    const send = vi.fn();
    await expect(simulateThenSendGraduatedSwap(transaction, (value) => simulateGraduatedSwapTransaction(value, wallet), vi.fn(), send)).rejects.toBeInstanceOf(GraduatedSwapSimulationError);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send when post-simulation context assertion fails", async () => {
    vi.spyOn(publicClient, "call").mockResolvedValue({ data: "0x" });
    const send = vi.fn();
    await expect(simulateThenSendGraduatedSwap(transaction, (value) => simulateGraduatedSwapTransaction(value, wallet), () => { throw new Error("This quote is stale or the wallet/network changed. Request a fresh quote."); }, send)).rejects.toThrow(/stale/i);
    expect(send).not.toHaveBeenCalled();
  });
});
