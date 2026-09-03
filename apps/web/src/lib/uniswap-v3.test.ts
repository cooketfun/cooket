import { decodeFunctionData, getAddress } from "viem";
import { ARC_CANONICAL_USDC } from "@cooket/contracts-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_POOL_FEE, approvalCall, buildGraduatedSwapTransaction, configuredUniswapV3, minimumOutput, orchestrateGraduatedSwap, quoteIsFresh, swapRouterAbi, type GraduatedQuote, type ValidatedPool } from "./uniswap-v3";
import { erc20TradeAbi } from "@/lib/contracts";
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
