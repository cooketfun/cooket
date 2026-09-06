import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ creator: vi.fn(), walletHoldings: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, ...apiMocks } };
});

import { WalletProfileContent } from "./wallet-profile-content";

const wallet = "0x00000000000000000000000000000000000000ab";
const tokenAddress = "0x0000000000000000000000000000000000000011";
const token = {
  address: tokenAddress,
  creator: wallet,
  name: "Created Coin",
  symbol: "CRT",
  initial_supply: "1000000000000000000000",
  created_at: { block_number: 10, transaction_hash: `0x${"a".repeat(64)}`, log_index: 1 },
  metrics: { trade_count: 1, buy_count: 1, sell_count: 0, volume: "1000000000000000000", fees: "0", unique_trader_count: 1, latest_trade_timestamp: null, current_price: "3000000000000000000", fully_diluted_value: "3000000000000000000000", holder_count: 1 },
};

function wrapper(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("wallet profile content", () => {
  it("shows indexed holdings separately from tokens created by connected or public wallets", async () => {
    apiMocks.creator.mockResolvedValue({ address: wallet, token_count: 1, volume: "1000000000000000000", tokens: [token] });
    apiMocks.walletHoldings.mockResolvedValue({ indexed_through_block: 123, items: [{ token_address: tokenAddress, name: "Held Coin", symbol: "HLD", raw_balance: "2000000000000000000", token_decimals: 18, lifecycle: "graduated", current_price: "3000000000000000000", estimated_value: "6000000000000000000", metrics: { trade_count: 2, volume: "5", holder_count: 1 } }] });
    render(wrapper(<WalletProfileContent address={wallet} surface="creator" createdLimit={12} />));
    expect(await screen.findByRole("heading", { name: "Holdings" })).toBeTruthy();
    expect(await screen.findByText("Held Coin")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("$6")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Created tokens" })).toBeTruthy();
    expect(await screen.findByText("Created Coin")).toBeTruthy();
    expect(apiMocks.creator).toHaveBeenCalledWith(wallet, "?limit=12");
    expect(apiMocks.walletHoldings).toHaveBeenCalledWith(wallet, "?limit=24");
  });

  it("renders the public empty portfolio state without treating creation as ownership", async () => {
    apiMocks.creator.mockResolvedValue({ address: wallet, token_count: 1, volume: "0", tokens: [token] });
    apiMocks.walletHoldings.mockResolvedValue({ indexed_through_block: 124, items: [] });
    render(wrapper(<WalletProfileContent address={wallet} surface="public-creator" createdLimit={24} />));
    expect(await screen.findByText("No Cooket tokens held by this wallet.")).toBeTruthy();
    expect(await screen.findByText("Created Coin")).toBeTruthy();
  });

  it("loads additional holdings only when the user requests the next bounded page", async () => {
    const secondAddress = "0x0000000000000000000000000000000000000022";
    apiMocks.creator.mockResolvedValue({ address: wallet, token_count: 0, volume: "0", tokens: [] });
    apiMocks.walletHoldings
      .mockResolvedValueOnce({ indexed_through_block: 125, items: [{ token_address: tokenAddress, name: "First Coin", symbol: "ONE", raw_balance: "1", token_decimals: 0, lifecycle: "active", current_price: null, estimated_value: null, metrics: { trade_count: 0, volume: "0", holder_count: 1 } }], next_cursor: "next-page" })
      .mockResolvedValueOnce({ indexed_through_block: 125, items: [{ token_address: secondAddress, name: "Second Coin", symbol: "TWO", raw_balance: "2", token_decimals: 0, lifecycle: "active", current_price: null, estimated_value: null, metrics: { trade_count: 0, volume: "0", holder_count: 1 } }] });
    render(wrapper(<WalletProfileContent address={wallet} surface="public-creator" createdLimit={24} />));

    expect(await screen.findByText("First Coin")).toBeTruthy();
    expect(apiMocks.walletHoldings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load more holdings" }));
    expect(await screen.findByText("Second Coin")).toBeTruthy();
    expect(apiMocks.walletHoldings).toHaveBeenNthCalledWith(2, wallet, "?limit=24&cursor=next-page");
  });
});
