import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletClient } from "viem";
import * as contracts from "./contracts";
import { executeDevBuy } from "./dev-buy";

const token = "0x0000000000000000000000000000000000000011" as const;
const creator = "0x0000000000000000000000000000000000000022" as const;
const creationHash = `0x${"aa".repeat(32)}` as const;
const buyHash = `0x${"bb".repeat(32)}` as const;
const quote = { tokenAmount: BigInt(12), reserveIn: BigInt(30), maxReserveIn: BigInt(34), curveCost: BigInt(28), protocolFee: BigInt(1), creatorFee: BigInt(1), slippageBps: 100, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) };

afterEach(() => vi.restoreAllMocks());

function input(overrides: Partial<Parameters<typeof executeDevBuy>[0]> = {}) {
  return {
    tokenAddress: token,
    creatorAddress: creator,
    amount: BigInt("100000000000000000"),
    creationHash,
    walletClient: {} as WalletClient,
    report: vi.fn(),
    ...overrides,
  };
}

describe("optional Dev buy execution", () => {
  it("quotes after creation, submits with the browser wallet, and waits for confirmation", async () => {
    const order: string[] = [];
    vi.spyOn(contracts, "readTradeState").mockImplementation(async () => { order.push("state"); return {} as never; });
    vi.spyOn(contracts, "quoteBuyByBudget").mockImplementation(async () => { order.push("quote"); return quote; });
    const submit = vi.spyOn(contracts, "submitBuy").mockImplementation(async () => { order.push("submit"); return buyHash; });
    vi.spyOn(contracts, "confirmTrade").mockImplementation(async () => { order.push("receipt"); return { status: "confirmed", hash: buyHash }; });
    const report = vi.fn();
    const launch = input({ report });

    await expect(executeDevBuy(launch)).resolves.toBe(buyHash);
    expect(order).toEqual(["state", "quote", "submit", "receipt"]);
    expect(submit).toHaveBeenCalledWith(launch.walletClient, creator, token, quote);
    expect(report.mock.calls.map(([state]) => state.status)).toEqual(["dev_buy_preparing", "dev_buy_awaiting_wallet", "dev_buy_submitted", "dev_buy_confirming", "dev_buy_confirmed"]);
  });

  it("preserves a safe retry boundary after browser-wallet rejection", async () => {
    vi.spyOn(contracts, "readTradeState").mockResolvedValue({} as never);
    vi.spyOn(contracts, "quoteBuyByBudget").mockResolvedValue(quote);
    vi.spyOn(contracts, "submitBuy").mockRejectedValue(new Error("User rejected the request"));

    await expect(executeDevBuy(input())).rejects.toMatchObject({
      retryable: true,
      rejected: true,
      buyHash: undefined,
    });
  });

  it("does not allow retry while a submitted receipt remains unknown", async () => {
    vi.spyOn(contracts, "readTradeState").mockResolvedValue({} as never);
    vi.spyOn(contracts, "quoteBuyByBudget").mockResolvedValue(quote);
    vi.spyOn(contracts, "submitBuy").mockResolvedValue(buyHash);
    vi.spyOn(contracts, "confirmTrade").mockResolvedValue({ status: "pending", hash: buyHash });

    await expect(executeDevBuy(input())).rejects.toMatchObject({
      retryable: false,
      rejected: false,
      buyHash,
    });
  });
});
