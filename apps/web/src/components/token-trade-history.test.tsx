import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const trades = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, trades } };
});

import { TradeHistory } from "./token-trading";

const wallet = "0x00000000000000000000000000000000000000aa" as const;
const token = "0x0000000000000000000000000000000000000011" as const;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const trade = (side: "buy" | "sell", source: "curve" | "uniswap_v3", trader: string, digit: string) => ({
  token_address: token, trader, side, token_amount: "16750000000000000000000000", reserve_amount: source === "curve" ? "25340000000000000000" : "25340000", curve_value: "0", protocol_fee: "0", creator_fee: "0", source,
  block_number: Number(digit), block_timestamp: 1_700_000_000, transaction_index: 0, transaction_hash: hash(digit), log_index: 0,
});
function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TradeHistory", () => {
  it("renders terminal rows with side, value, amount, trader provenance, and ArcScan actions", async () => {
    trades.mockResolvedValue({ indexed_through_block: 10, items: [trade("buy", "curve", wallet, "1"), trade("sell", "uniswap_v3", "0x0000000000000000000000000000000000000000", "2")] });
    render(<TradeHistory tokenAddress={token} symbol="PCAT" walletAddress={wallet} provisional={[]} />, { wrapper: Providers });
    expect((await screen.findAllByText("BUY")).length).toBe(1);
    expect(screen.getByText("SELL")).toBeTruthy();
    expect(screen.getAllByText("$25.34")).toHaveLength(2);
    expect(screen.getAllByText("16.75M $PCAT")).toHaveLength(2);
    expect(screen.getByText(wallet)).toBeTruthy();
    expect(screen.getByText("Trader unavailable")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "View on ArcScan ↗" })).toHaveLength(2);
    const row = screen.getByText("BUY").closest("li");
    expect(row?.className).toContain("grid-cols-2");
    expect(row?.className).toContain("lg:grid-cols-");
  });

  it("filters the loaded canonical records for Your trades without changing the API request", async () => {
    trades.mockResolvedValue({ indexed_through_block: 10, items: [trade("buy", "curve", wallet, "1"), trade("sell", "curve", "0x00000000000000000000000000000000000000bb", "2")] });
    const user = userEvent.setup();
    render(<TradeHistory tokenAddress={token} symbol="PCAT" walletAddress={wallet} provisional={[]} />, { wrapper: Providers });
    await screen.findByText("BUY");
    await user.click(screen.getByRole("tab", { name: "Your trades" }));
    expect(screen.getByText("BUY")).toBeTruthy();
    expect(screen.queryByText("SELL")).toBeNull();
    expect(trades).toHaveBeenCalledWith(token, "?limit=20");
    expect(screen.getByText(/filters the currently loaded recent records/)).toBeTruthy();
  });
});
