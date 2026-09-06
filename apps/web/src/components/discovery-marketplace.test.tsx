import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Token } from "@cooket/types";

const apiMocks = vi.hoisted(() => ({
  trending: vi.fn(),
  listTokens: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, trending: apiMocks.trending, listTokens: apiMocks.listTokens } };
});

import { DiscoveryMarketplace } from "./discovery-marketplace";
import { HeaderTokenSearch } from "./header-token-search";

const token = (overrides: Partial<Token> = {}): Token => ({
  address: "0x0000000000000000000000000000000000000001",
  creator: "0x0000000000000000000000000000000000000002",
  name: "Cooket One",
  symbol: "ZNK1",
  initial_supply: "1000000000000000000000",
  image_url: "/assets/znk1.png",
  x_url: "https://x.com/cooketone",
  created_at: { block_number: 123, transaction_hash: "0xabc", log_index: 0 },
  metrics: { trade_count: 12, buy_count: 8, sell_count: 4, volume: "5000000000000000000", fees: "0", unique_trader_count: 6, latest_trade_timestamp: 1_700_000_000, current_price: "1000000000000000", fully_diluted_value: "10000000000000000000", holder_count: 9 },
  curve: { address: "0x0000000000000000000000000000000000000003", sold_supply: "800", reserve_balance: "5", graduation_threshold: "1000" },
  ...overrides,
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiMocks.trending.mockResolvedValue({ items: [token()] });
  apiMocks.listTokens.mockResolvedValue({ items: [token()] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("marketplace discovery", () => {
  it("renders API-backed top tokens and clickable launch cards", async () => {
    render(<DiscoveryMarketplace />, { wrapper: Providers });
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Open Cooket One" })).toHaveLength(2));
    expect(screen.getAllByRole("link", { name: "Open Cooket One" })[0].getAttribute("href")).toBe("/token/0x0000000000000000000000000000000000000001");
    expect(screen.getByText("Block #123")).toBeTruthy();
    expect(screen.getAllByText("24h").length).toBeGreaterThan(0);
  });

  it("switches filters and view modes while keeping results API-backed", async () => {
    const user = userEvent.setup();
    render(<DiscoveryMarketplace />, { wrapper: Providers });
    await screen.findAllByRole("link", { name: "Open Cooket One" });

    await user.click(screen.getByRole("tab", { name: "New" }));
    await waitFor(() => expect(apiMocks.listTokens).toHaveBeenCalledWith("?limit=12&view=new"));
    expect(screen.getByRole("tab", { name: "New" }).getAttribute("aria-selected")).toBe("true");

    const listButton = screen.getByRole("button", { name: "List view" });
    await user.click(listButton);
    expect(listButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("uses API cursors for next and previous pages and resets when the filter changes", async () => {
    apiMocks.trending.mockImplementation((query: string) => Promise.resolve(query.includes("cursor=page-two")
      ? { items: [token({ address: "0x0000000000000000000000000000000000000002", name: "Second Page" })] }
      : { items: [token()], next_cursor: "page-two" }));
    const user = userEvent.setup();
    render(<DiscoveryMarketplace />, { wrapper: Providers });
    const next = await screen.findByRole("button", { name: "Next page" });
    await user.click(next);
    expect(await screen.findByText("Second Page")).toBeTruthy();
    expect(apiMocks.trending).toHaveBeenCalledWith("?limit=12&cursor=page-two");
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(screen.getAllByText("Cooket One").length).toBeGreaterThan(0));

    await user.click(screen.getByRole("tab", { name: "Top" }));
    await waitFor(() => expect(apiMocks.listTokens).toHaveBeenCalledWith("?limit=12&view=top"));
    expect(screen.queryByRole("button", { name: "Previous page" })).toBeNull();
  });

  it("shows honest empty and error states with retry", async () => {
    apiMocks.trending.mockResolvedValue({ items: [] });
    render(<DiscoveryMarketplace />, { wrapper: Providers });
    expect(await screen.findByText("No indexed market leaders yet.")).toBeTruthy();
    expect(await screen.findByText("No launches in this view")).toBeTruthy();
  });
});

describe("header token search", () => {
  it("searches the canonical token endpoint and navigates to token detail", async () => {
    const user = userEvent.setup();
    render(<HeaderTokenSearch />, { wrapper: Providers });
    await user.type(screen.getByRole("combobox", { name: "Search tokens" }), "cooket");
    await waitFor(() => expect(apiMocks.listTokens).toHaveBeenCalledWith("?search=cooket&limit=6"));
    const result = await screen.findByRole("link", { name: /Cooket One/ });
    expect(result.getAttribute("href")).toBe("/token/0x0000000000000000000000000000000000000001");
  });
});
