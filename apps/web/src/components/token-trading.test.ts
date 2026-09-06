import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as contracts from "@/lib/contracts";
import { activeTradeStateQueryKey, loadActiveTradeState, TokenTrading, tradeInvalidationKeys } from "./token-trading";

vi.mock("@/components/graduated-token-swap", () => ({ GraduatedTokenSwap: () => "Swap terminal" }));
vi.mock("@/components/token-trade-panel", () => ({ TokenTradePanel: () => "Curve terminal" }));
vi.mock("@/providers/active-wallet-provider", () => ({
  activeWalletStatusMessage: () => "Wallet ready",
  useActiveWallet: () => ({ connected: true, canTransact: true, status: "wallet_ready" }),
}));

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("trade query refresh", () => {
  it("invalidates balances, pricing, token data, trades, activity, and every chart timeframe after confirmation", () => {
    const token = "0x0000000000000000000000000000000000000011" as const;
    expect(tradeInvalidationKeys(token)).toEqual([
      ["trade-state", token],
      ["curve-availability", token],
      ["trades", token],
      ["token-activity", token],
      ["token-chart", token],
      ["token", token],
      ["tokens"],
      ["trending"],
    ]);
  });

  it("formats recent trade values from indexed source rather than assuming native decimals", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/token-trading.tsx"), "utf8");
    expect(source).toContain("formatTradeUsdc(marketRaw, source)");
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

  it("switches a mounted active token from curve trading to the canonical graduated swap", async () => {
    const token = "0x0000000000000000000000000000000000000011" as const;
    const creator = "0x0000000000000000000000000000000000000022" as const;
    const pool = "0x0000000000000000000000000000000000000033" as const;
    vi.spyOn(contracts, "readCurveAvailability").mockResolvedValue({} as never);
    vi.spyOn(contracts, "readTradeState").mockResolvedValue({ nativeBalance: BigInt(0), tokenBalance: BigInt(0) } as never);
    const rendered = render(createElement(TokenTrading, { tokenAddress: token, creator, symbol: "COOKET", graduated: false }), { wrapper: Providers });

    expect(await screen.findByText("Curve terminal")).toBeTruthy();
    rendered.rerender(createElement(TokenTrading, { tokenAddress: token, creator, symbol: "COOKET", graduated: true, canonicalPoolAddress: pool }));

    expect(screen.getByText("Swap terminal")).toBeTruthy();
    expect(screen.queryByText("Curve terminal")).toBeNull();
    expect(screen.queryByText("This trade is unavailable for the current Cooket curve lifecycle.")).toBeNull();
  });

  it("does not leave a stale active surface on unavailable curve trading after graduation", async () => {
    const token = "0x0000000000000000000000000000000000000011" as const;
    const creator = "0x0000000000000000000000000000000000000022" as const;
    const pool = "0x0000000000000000000000000000000000000033" as const;
    vi.spyOn(contracts, "readCurveAvailability").mockResolvedValue(null);
    vi.spyOn(contracts, "readTradeState").mockResolvedValue({ nativeBalance: BigInt(0), tokenBalance: BigInt(0) } as never);
    const rendered = render(createElement(TokenTrading, { tokenAddress: token, creator, symbol: "COOKET", graduated: false }), { wrapper: Providers });

    expect(await screen.findByText("Trading is not available for this token.")).toBeTruthy();
    rendered.rerender(createElement(TokenTrading, { tokenAddress: token, creator, symbol: "COOKET", graduated: true, canonicalPoolAddress: pool }));

    expect(screen.getByText("Swap terminal")).toBeTruthy();
    expect(screen.queryByText("Trading is not available for this token.")).toBeNull();
  });
});
