import { afterEach, describe, expect, it, vi } from "vitest";
import { api, resolvePublicApiURL } from "./api";

const emptyPage = { items: [] };
const address = "0x0000000000000000000000000000000000000011";
const pool = "0x0000000000000000000000000000000000000022";
const manager = "0x0000000000000000000000000000000000000033";
const custodian = "0x0000000000000000000000000000000000000044";
const transactionHash = `0x${"ab".repeat(32)}`;
const tokenPayload = (graduation?: Record<string, unknown>) => ({
  address,
  creator: "0x0000000000000000000000000000000000000055",
  name: "Graduation Token",
  symbol: "GRAD",
  initial_supply: "1000",
  created_at: { block_number: 1, transaction_hash: transactionHash, log_index: 0 },
  metrics: { trade_count: 0, buy_count: 0, sell_count: 0, volume: "0", fees: "0", unique_trader_count: 0, latest_trade_timestamp: null, current_price: null, fully_diluted_value: null, holder_count: null },
  curve: { address: "0x0000000000000000000000000000000000000066", canonical_pool_address: pool, sold_supply: "800", reserve_balance: "3" },
  ...(graduation ? { graduation } : {}),
});
afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("requires the intended API origin for production while preserving local development", () => {
    expect(resolvePublicApiURL(undefined, false)).toBe("http://localhost:4200");
    expect(resolvePublicApiURL("https://api.testnet.cooket.fun/", true)).toBe("https://api.testnet.cooket.fun");
    expect(() => resolvePublicApiURL(undefined, true)).toThrow(/required/i);
    expect(() => resolvePublicApiURL("https://preview.example", true)).toThrow(/api\.testnet\.cooket\.fun/i);
    expect(() => resolvePublicApiURL("not-a-url", false)).toThrow(/absolute/i);
  });
  it("parses successful and empty collections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyPage), { status: 200 })));
    await expect(api.listTokens()).resolves.toEqual(emptyPage);
  });
  it("preserves normalized backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "not_found", message: "token not found" } }), { status: 404 })));
    await expect(api.token("0x0000000000000000000000000000000000000001")).rejects.toMatchObject({ status: 404, code: "not_found", message: "token not found" });
  });
  it("preserves normalized validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "invalid_request", message: "limit must be between 1 and 100" } }), { status: 400 })));
    await expect(api.listTokens("?limit=101")).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });
  it("parses the runtime Chainlink ETH/USD reference", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ price: "2500.12345678", price_decimals: 8, updated_at: "2026-08-15T10:00:00Z", feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", source: "chainlink_eth_usd", max_age_seconds: 3600 }), { status: 200 })));
    await expect(api.ethUsdPrice()).resolves.toMatchObject({ price: "2500.12345678", price_decimals: 8, source: "chainlink_eth_usd" });
  });
  it("normalizes malformed HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    await expect(api.listTokens()).rejects.toMatchObject({ status: 500, code: "http_error" });
  });
  it("parses V3 pricing and canonical chart payloads", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token_address: "0x1", current_price: "7", fully_diluted_value: "7000", source: "indexed_v3_curve" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ interval: "1h", supported_intervals: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"], candles: [{ bucket_start: 3600, trade_count: 1, buy_count: 1, sell_count: 0, volume: "10", unique_trader_count: 1, open_price: "6", high_price: "8", low_price: "5", close_price: "7" }] }), { status: 200 })));
    await expect(api.pricing("0x1")).resolves.toMatchObject({ fully_diluted_value: "7000", source: "indexed_v3_curve" });
    await expect(api.chart("0x1")).resolves.toMatchObject({ interval: "1h", supported_intervals: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"], candles: [expect.objectContaining({ open_price: "6", high_price: "8", low_price: "5", close_price: "7" })] });
  });

  it("validates the complete Phase 10A graduation payload", async () => {
    const graduation = {
      phase: "graduated",
      canonical_pool_address: pool,
      graduation_manager_address: manager,
      lp_custodian_address: custodian,
      position_token_id: "77",
      liquidity: "123456789",
      token_amount: "200000000000000000000000000",
      eth_amount: "3000000000000000000",
      sold_supply: "800000000000000000000000000",
      curve_terminal_at: { block_number: 100, transaction_hash: transactionHash, log_index: 8 },
      settled_at: { block_number: 100, transaction_hash: transactionHash, log_index: 4 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(tokenPayload(graduation)), { status: 200 })));
    await expect(api.token(address)).resolves.toMatchObject({ curve: { canonical_pool_address: pool }, graduation });
  });

  it("accepts graduated curve evidence when optional settlement fields are absent", async () => {
    const graduation = { phase: "graduated", canonical_pool_address: pool, graduation_manager_address: manager, token_amount: "200", eth_amount: "3", curve_terminal_at: { block_number: 100, transaction_hash: transactionHash, log_index: 8 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(tokenPayload(graduation)), { status: 200 })));
    await expect(api.token(address)).resolves.toMatchObject({ graduation });
  });

  it("rejects malformed graduation addresses and provenance", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenPayload({ phase: "graduated", lp_custodian_address: "0x1234" })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenPayload({ phase: "graduated", settled_at: { block_number: 1, transaction_hash: "0xdeadbeef", log_index: 2 } })), { status: 200 })));
    await expect(api.token(address)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(api.token(address)).rejects.toMatchObject({ code: "invalid_response" });
  });
});
