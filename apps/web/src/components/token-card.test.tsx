import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Token } from "@cooket/types";
import { TokenCard } from "./token-card";

const token: Token = {
  address: "0x0000000000000000000000000000000000000001", creator: "0x0000000000000000000000000000000000000002",
  name: "Age Token", symbol: "AGE", initial_supply: "1",
  created_at: { block_number: 1, block_timestamp: 1_788_509_400, transaction_hash: `0x${"11".repeat(32)}`, log_index: 0 },
  metrics: { trade_count: 0, buy_count: 0, sell_count: 0, volume: "0", fees: "0", unique_trader_count: 0, latest_trade_timestamp: null, current_price: null, fully_diluted_value: null, holder_count: 0 },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("TokenCard age", () => {
  it("keeps server and initial client output deterministic, then displays live age", async () => {
    vi.spyOn(Date, "now").mockReturnValue((token.created_at.block_timestamp! + 3_600) * 1_000);
    expect(renderToString(<TokenCard token={token} />)).toContain("Loading");
    render(<TokenCard token={token} />);
    await waitFor(() => expect(screen.getByText("1h")).toBeTruthy());
    expect(screen.getByText("1h").getAttribute("title")).toMatch(/Sep .*2026.*UTC/);
  });

  it("uses a clear fallback only when launch time is absent", () => {
    render(<TokenCard token={{ ...token, created_at: { ...token.created_at, block_timestamp: undefined } }} />);
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.getByText("Not available").getAttribute("title")).toBe("Launch timestamp unavailable");
  });
});
