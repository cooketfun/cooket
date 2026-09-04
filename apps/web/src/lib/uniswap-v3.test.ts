import { decodeFunctionData, getAddress, type Hash } from "viem";
import { ARC_CANONICAL_USDC } from "@cooket/contracts-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/arc-safety", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/arc-safety")>();
  return { ...original, assertArcProtocolEconomicsReady: vi.fn(original.assertArcProtocolEconomicsReady) };
});

import { CANONICAL_POOL_FEE, GRADUATED_SWAP_RPC_TIMEOUT_MS, GRADUATED_SWAP_SIMULATION_TIMEOUT_MS, GraduatedSwapRpcTimeoutError, GraduatedSwapSimulationError, GraduatedSwapSimulationTimeoutError, approvalCall, buildGraduatedSwapTransaction, configuredUniswapV3, minimumOutput, orchestrateGraduatedSwap, quoteIsFresh, readGraduatedAllowance, readGraduatedSwapState, readGraduatedTokenDecimals, simulateGraduatedSwapTransaction, swapRouterAbi, waitForGraduatedAllowance, type GraduatedQuote, type GraduatedSwapTransaction, type ValidatedPool } from "./uniswap-v3";
import { erc20TradeAbi, publicClient } from "@/lib/contracts";
import { ARC_PROTOCOL_ECONOMICS_BLOCKER, assertArcProtocolEconomicsReady } from "@/lib/arc-safety";

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
    const params = decoded.args?.[0] as { tokenIn: string; tokenOut: string; recipient: string; deadline: bigint; amountIn: bigint; amountOutMinimum: bigint };
    expect(transaction).toMatchObject({ to: pool.router, value: BigInt(0) });
    expect(decoded.functionName).toBe("exactInputSingle");
    expect(getAddress(params.tokenIn)).toBe(side === "buy" ? ARC_CANONICAL_USDC : token);
    expect(getAddress(params.tokenOut)).toBe(side === "buy" ? token : ARC_CANONICAL_USDC);
    expect(getAddress(params.recipient)).toBe(wallet);
    expect(params.deadline).toBe(BigInt(2_000));
    expect(params.amountIn).toBe(BigInt(1_000));
    expect(params.amountOutMinimum).toBe(BigInt(895));
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
    vi.stubEnv("NEXT_PUBLIC_ARC_TESTNET_FINANCIAL_EXECUTION_ENABLED", "");
    const state = { usdc: BigInt(1000), token: BigInt(1000), allowance: BigInt(0) };
    const approve = vi.fn();
    const send = vi.fn();
    await expect(orchestrateGraduatedSwap({ side: "buy", amountIn: BigInt(1000), initialState: state, readAllowance: vi.fn().mockResolvedValue(BigInt(1000)), approve, assertContext: vi.fn(), buildTransaction: () => buildGraduatedSwapTransaction(pool, quote("buy"), wallet), send, allowanceDelays: [0] })).rejects.toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
    expect(approve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("pins the 1% canonical pool tier", () => expect(CANONICAL_POOL_FEE).toBe(10_000));
});

describe("graduated swap simulation diagnostic", () => {
  const transaction = buildGraduatedSwapTransaction(pool, quote("buy"), wallet);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("bounds the eth_call timeout", () => {
    expect(GRADUATED_SWAP_SIMULATION_TIMEOUT_MS).toBe(15_000);
  });

  it("wraps an eth_call revert as a simulation failure", async () => {
    vi.spyOn(publicClient, "call").mockRejectedValue(new Error("execution reverted: STF"));
    await expect(simulateGraduatedSwapTransaction(transaction, wallet)).rejects.toSatisfy((reason: unknown) => reason instanceof GraduatedSwapSimulationError && /execution reverted/i.test((reason as Error).message) && !(reason instanceof GraduatedSwapSimulationTimeoutError));
  });

  it("times out a hanging eth_call and aborts it", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(publicClient, "call").mockImplementation((request) => {
      signal = request.requestOptions?.signal;
      return new Promise(() => undefined);
    });
    await expect(simulateGraduatedSwapTransaction(transaction, wallet, 25)).rejects.toBeInstanceOf(GraduatedSwapSimulationTimeoutError);
    expect(signal?.aborted).toBe(true);
  });
});

describe("graduated swap submission path", () => {
  const hash = `0x${"ab".repeat(32)}` as Hash;
  const funded = { usdc: BigInt(1000), token: BigInt(1000), allowance: BigInt(0) };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(assertArcProtocolEconomicsReady).mockImplementation(() => {
      throw new Error(ARC_PROTOCOL_ECONOMICS_BLOCKER);
    });
  });

  function allowArcWrites() {
    vi.mocked(assertArcProtocolEconomicsReady).mockImplementation(() => undefined);
  }

  function swapArgs(side: "buy" | "sell", overrides: Partial<Parameters<typeof orchestrateGraduatedSwap>[0]> = {}) {
    const payload = buildGraduatedSwapTransaction(pool, quote(side), wallet);
    return {
      side,
      amountIn: BigInt(1000),
      initialState: funded,
      readAllowance: vi.fn().mockResolvedValue(BigInt(1000)),
      approve: vi.fn().mockResolvedValue(undefined),
      assertContext: vi.fn(),
      buildTransaction: vi.fn(() => payload),
      send: vi.fn().mockResolvedValue(hash),
      allowanceDelays: [0] as const,
      ...overrides,
    };
  }

  it("does not reread token decimals with balances and allowance", async () => {
    const readContract = vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => {
      if (request.functionName === "decimals") return 18;
      return BigInt(1);
    });
    await expect(readGraduatedSwapState(token, wallet, pool.router, "buy")).resolves.toEqual({ usdc: BigInt(1), token: BigInt(1), allowance: BigInt(1) });
    expect(readContract.mock.calls.some((call) => call[0]?.functionName === "decimals")).toBe(false);
  });

  it("reads token decimals through a dedicated cached helper", async () => {
    const readContract = vi.spyOn(publicClient, "readContract").mockResolvedValue(18);
    await expect(readGraduatedTokenDecimals(token)).resolves.toBe(18);
    expect(readContract).toHaveBeenCalledOnce();
    expect(readContract.mock.calls[0]?.[0]).toMatchObject({ address: token, functionName: "decimals" });
  });

  it("times out a hanging allowance reread", async () => {
    await expect(waitForGraduatedAllowance(() => new Promise(() => undefined), BigInt(1), [0], 25)).rejects.toBeInstanceOf(GraduatedSwapRpcTimeoutError);
  });

  it("times out hanging balance and allowance eth_calls and aborts them", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(publicClient, "readContract").mockImplementation((request) => {
      signal = (request as { requestOptions?: { signal?: AbortSignal } }).requestOptions?.signal;
      return new Promise(() => undefined);
    });
    await expect(readGraduatedSwapState(token, wallet, pool.router, "buy", 25)).rejects.toBeInstanceOf(GraduatedSwapRpcTimeoutError);
    expect(signal?.aborted).toBe(true);
  });

  it("times out a hanging dedicated allowance read", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(publicClient, "readContract").mockImplementation((request) => {
      signal = (request as { requestOptions?: { signal?: AbortSignal } }).requestOptions?.signal;
      return new Promise(() => undefined);
    });
    await expect(readGraduatedAllowance(token, wallet, pool.router, "buy", 25)).rejects.toBeInstanceOf(GraduatedSwapRpcTimeoutError);
    expect(signal?.aborted).toBe(true);
  });

  it.each(["buy", "sell"] as const)("sends a %s immediately when allowance is already sufficient", async (side) => {
    allowArcWrites();
    const input = swapArgs(side, { initialState: { ...funded, allowance: BigInt(1000) } });
    const simulate = vi.fn();
    await expect(orchestrateGraduatedSwap(input)).resolves.toBe(hash);
    expect(input.approve).not.toHaveBeenCalled();
    expect(input.readAllowance).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
    expect(input.buildTransaction).toHaveBeenCalledOnce();
    expect(input.send).toHaveBeenCalledOnce();
    expect(input.send).toHaveBeenCalledWith(input.buildTransaction());
    expect(input.assertContext).toHaveBeenCalledTimes(2);
  });

  it.each(["buy", "sell"] as const)("does not wait on a hanging %s state reread when allowance is already sufficient", async (side) => {
    allowArcWrites();
    const input = swapArgs(side, {
      initialState: { ...funded, allowance: BigInt(1000) },
      readAllowance: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    await expect(orchestrateGraduatedSwap(input)).resolves.toBe(hash);
    expect(input.readAllowance).not.toHaveBeenCalled();
    expect(input.send).toHaveBeenCalledOnce();
  });

  it.each(["buy", "sell"] as const)("approves a %s, verifies allowance, then sends without simulation", async (side) => {
    allowArcWrites();
    const payload = buildGraduatedSwapTransaction(pool, quote(side), wallet);
    const order: string[] = [];
    const input = swapArgs(side, {
      approve: vi.fn(async () => { order.push("approve"); }),
      readAllowance: vi.fn(async () => { order.push("allowance"); return BigInt(1000); }),
      buildTransaction: vi.fn(() => { order.push("build"); return payload; }),
      send: vi.fn(async (transaction: GraduatedSwapTransaction) => { order.push("send"); expect(transaction).toBe(payload); return hash; }),
    });
    await expect(orchestrateGraduatedSwap(input)).resolves.toBe(hash);
    expect(input.approve).toHaveBeenCalledOnce();
    expect(input.readAllowance).toHaveBeenCalledOnce();
    expect(order).toEqual(["approve", "allowance", "build", "send"]);
  });

  it.each(["buy", "sell"] as const)("times out a hanging %s allowance reread after approval and does not send", async (side) => {
    allowArcWrites();
    const input = swapArgs(side, {
      readAllowance: vi.fn().mockReturnValue(new Promise(() => undefined)),
      rpcTimeoutMs: 25,
    });
    await expect(orchestrateGraduatedSwap(input)).rejects.toBeInstanceOf(GraduatedSwapRpcTimeoutError);
    expect(input.approve).toHaveBeenCalledOnce();
    expect(input.send).not.toHaveBeenCalled();
  });

  it.each(["buy", "sell"] as const)("does not send a %s when confirmed approval is still insufficient", async (side) => {
    allowArcWrites();
    const input = swapArgs(side, { readAllowance: vi.fn().mockResolvedValue(BigInt(1)) });
    await expect(orchestrateGraduatedSwap(input)).rejects.toThrow(/Confirmed approval is still insufficient/);
    expect(input.approve).toHaveBeenCalledOnce();
    expect(input.send).not.toHaveBeenCalled();
  });

  it("does not send a buy with an insufficient USDC balance", async () => {
    allowArcWrites();
    const input = swapArgs("buy", { initialState: { ...funded, usdc: BigInt(1), allowance: BigInt(1000) } });
    await expect(orchestrateGraduatedSwap(input)).rejects.toThrow(/Insufficient canonical ERC20 USDC balance/);
    expect(input.approve).not.toHaveBeenCalled();
    expect(input.send).not.toHaveBeenCalled();
  });

  it("does not send a sell with an insufficient token balance", async () => {
    allowArcWrites();
    const input = swapArgs("sell", { initialState: { ...funded, token: BigInt(1), allowance: BigInt(1000) } });
    await expect(orchestrateGraduatedSwap(input)).rejects.toThrow(/Insufficient token balance/);
    expect(input.approve).not.toHaveBeenCalled();
    expect(input.send).not.toHaveBeenCalled();
  });

  it("does not send when the quote is stale or the wallet/network changed", async () => {
    allowArcWrites();
    const input = swapArgs("buy", {
      initialState: { ...funded, allowance: BigInt(1000) },
      assertContext: vi.fn(() => { throw new Error("This quote is stale or the wallet/network changed. Request a fresh quote."); }),
    });
    await expect(orchestrateGraduatedSwap(input)).rejects.toThrow(/stale or the wallet\/network changed/);
    expect(input.send).not.toHaveBeenCalled();
  });

  it("does not send after approval if the quote becomes stale", async () => {
    allowArcWrites();
    let checks = 0;
    const input = swapArgs("buy", {
      assertContext: vi.fn(() => {
        checks += 1;
        if (checks > 1) throw new Error("This quote is stale or the wallet/network changed. Request a fresh quote.");
      }),
    });
    await expect(orchestrateGraduatedSwap(input)).rejects.toThrow(/stale or the wallet\/network changed/);
    expect(input.approve).toHaveBeenCalledOnce();
    expect(input.send).not.toHaveBeenCalled();
  });
});
