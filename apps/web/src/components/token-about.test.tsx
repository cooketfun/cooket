import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Token } from "@cooket/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenAbout } from "./token-about";

const token = (overrides: Partial<Token> = {}): Token => ({
  address: "0x0000000000000000000000000000000000000011",
  creator: "0x0000000000000000000000000000000000000022",
  name: "Prod Cat",
  symbol: "PCAT",
  initial_supply: "1000000000000000000000000000",
  description: "Canonical indexed description.",
  website_url: "https://example.com",
  x_url: "https://x.com/prodcat",
  created_at: { block_number: 100, block_timestamp: 1_700_000_000, transaction_hash: `0x${"1".repeat(64)}`, log_index: 0 },
  metrics: { trade_count: 12, buy_count: 9, sell_count: 3, volume: "25340000000000000000", fees: "0", unique_trader_count: 7, latest_trade_timestamp: null, current_price: "1000000000000000", fully_diluted_value: "1000000000000000000000", holder_count: 5 },
  curve: { address: "0x0000000000000000000000000000000000000033", sold_supply: "1", reserve_balance: "1", lifecycle: "active" },
  ...overrides,
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("TokenAbout", () => {
  it("renders canonical description, stats, conditional social links, and copy control", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<TokenAbout token={token()} />);
    expect(screen.getByText("Canonical indexed description.")).toBeTruthy();
    expect(screen.getByText("$25.34")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Website/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /X \/ Twitter/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Telegram/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy token address" }));
    expect(writeText).toHaveBeenCalledWith(token().address);
  });

  it("uses the exact fallback and does not fabricate unavailable window metrics", () => {
    render(<TokenAbout token={token({ description: undefined, website_url: undefined, x_url: undefined })} />);
    expect(screen.getByText("No description found")).toBeTruthy();
    expect(screen.queryByText("5M")).toBeNull();
    expect(screen.queryByText("Buy volume")).toBeNull();
    expect(screen.getByRole("link", { name: /Search on X/ })).toBeTruthy();
  });
});
