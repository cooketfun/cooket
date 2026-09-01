import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as contracts from "@/lib/contracts";
import { activeTradeStateQueryKey, loadActiveTradeState, TokenTrading, tradeInvalidationKeys } from "./token-trading";

vi.mock("@/components/graduated-token-swap", () => ({ GraduatedTokenSwap: () => "Swap terminal" }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("trade query refresh", () => {
  it("invalidates balances, pricing, token data, trades, and activity after confirmation", () => {
    const token = "0x0000000000000000000000000000000000000011" as const;
    expect(tradeInvalidationKeys(token)).toEqual([
      ["trade-state", token],
      ["curve-availability", token],
      ["trades", token],
      ["activity", token],
      ["token", token],
      ["tokens"],
      ["trending"],
    ]);
  });

  it("reads balances and allowance for the active wallet address", async () => {
    const token = "0x0000000000000000000000000000000000000011" as const;
    const external = "0x0000000000000000000000000000000000000022" as const;
    const state = { nativeBalance: BigInt(0), tokenBalance: BigInt(0) };
    const read = vi.spyOn(contracts, "readTradeState").mockResolvedValue(state as never);
    expect(activeTradeStateQueryKey(token, external)).toEqual(["trade-state", token, external]);
    await expect(loadActiveTradeState(token, external)).resolves.toBe(state);
    expect(read).toHaveBeenCalledWith(token, external);
  });

  it("renders the isolated V3 swap terminal for graduated tokens", () => {
    const token = "0x0000000000000000000000000000000000000011" as const;
    const creator = "0x0000000000000000000000000000000000000022" as const;
    render(TokenTrading({ tokenAddress: token, creator, symbol: "COOKET", graduated: true }));
    expect(screen.getByText("Swap terminal")).toBeTruthy();
    expect(screen.queryByText("External liquidity active")).toBeNull();
  });
});
