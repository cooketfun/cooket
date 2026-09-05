import { describe, expect, it, vi } from "vitest";
import type { ChartPage, ChartPoint, Token } from "@cooket/types";
import { CooketTradingViewDatafeed, TRADINGVIEW_RESOLUTION_INTERVAL, candleToTradingViewBar, cooketIntervalForResolution, cooketSymbol, nativeUsdc18ToDisplayNumber, tradingViewPriceScale } from "./tradingview-datafeed";
import type { RealtimeTrade } from "./token-realtime";

const address = "0x5B95B40217864B8F1793aF848a0A141E1e23aF1e";
const token: Pick<Token, "address" | "name" | "symbol"> = { address, name: "Arc Meow", symbol: "meow" };
const point = (overrides: Partial<ChartPoint> = {}): ChartPoint => ({ bucket_start: 120, trade_count: 1, buy_count: 1, sell_count: 0, volume: "2500000000000000000", unique_trader_count: 1, open_price: "1000000000000000001", high_price: "2000000000000000000", low_price: "500000000000000000", close_price: "1500000000000000000", ...overrides });
const page = (candles: ChartPoint[], indexed_through_block?: number): ChartPage => ({ interval: "1m", supported_intervals: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"], candles, indexed_through_block });
const trade = (overrides: Partial<RealtimeTrade> = {}): RealtimeTrade => ({ identity: "5042002:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1", chain_id: 5042002, token: address, market: "0x1111111111111111111111111111111111111111", source: "curve", side: "buy", block_number: 10, block_timestamp: 121, transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", log_index: 1, removed: false, received_at: "ignored", token_amount_raw: "1000000000000000000", usdc_amount_raw: "2000000000000000000", usdc_decimals: 18, ...overrides });

describe("Cooket TradingView-compatible datafeed", () => {
  it("maps every supported TradingView resolution exactly to the canonical interval", () => {
    expect(TRADINGVIEW_RESOLUTION_INTERVAL).toEqual({ "1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", D: "1d", W: "1w" });
    expect(cooketIntervalForResolution("1D")).toBeNull();
    expect(cooketIntervalForResolution("30")).toBeNull();
  });

  it("resolves arbitrary Cooket tokens as UTC USDC markets", async () => {
    const feed = new CooketTradingViewDatafeed(token, vi.fn());
    const resolved = await new Promise<ReturnType<typeof cooketSymbol>>((resolve, reject) => feed.resolveSymbol("ignored", resolve, reject));
    expect(resolved).toMatchObject({ name: "MEOW / USDC", ticker: "MEOW / USDC", description: "Arc Meow", token_address: address, session: "24x7", timezone: "Etc/UTC", currency_code: "USDC", pricescale: 10_000_000_000, volume_precision: 18 });
    expect(cooketSymbol({ ...token, address: address.toLowerCase(), name: "Other", symbol: "oth" }).name).toBe("OTH / USDC");
  });

  it("uses adaptive, safe display ticks without confusing them with 18-decimal storage", () => {
    const small = "2470000000000"; // 0.00000247 native-USDC price
    const scale = tradingViewPriceScale(small);
    expect(Number.isSafeInteger(scale)).toBe(true);
    expect(scale).toBe(100_000_000_000);
    expect(nativeUsdc18ToDisplayNumber(small)).toBe(0.00000247);
    expect(nativeUsdc18ToDisplayNumber(small)! * scale).toBe(247_000);
    expect(tradingViewPriceScale("1")).toBe(1_000_000_000_000);
  });

  it("converts canonical 18-decimal execution candles and indexed volume at a single display boundary", () => {
    expect(nativeUsdc18ToDisplayNumber("1000000000000000001")).toBeCloseTo(1, 14);
    expect(nativeUsdc18ToDisplayNumber("not-an-integer")).toBeNull();
    expect(candleToTradingViewBar(point())).toEqual({ time: 120_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 2.5 });
    expect(candleToTradingViewBar(point({ open_price: null }))).toBeNull();
  });

  it("requests bounded canonical latest, older, and countBack history without local latest-window filtering", async () => {
    const fetch = vi.fn(async (_address: string, query: string) => {
      if (query.includes("from=500")) return page([]); // truly before token creation
      if (query.includes("to=180&limit=2")) return page([point({ bucket_start: 60 }), point({ bucket_start: 120 })]);
      if (query.includes("from=100")) return page([point({ bucket_start: 120 })]); // an old API slice, not latest 1,000
      return page([point({ bucket_start: 180 })]);
    });
    const feed = new CooketTradingViewDatafeed(token, fetch);
    const result = await new Promise<{ bars: unknown[]; noData: boolean }>((resolve, reject) => {
      void feed.getBars(cooketSymbol(token), "5", { from: 100, to: 180 }, (bars, meta) => resolve({ bars, noData: meta.noData }), reject);
    });
    expect(fetch).toHaveBeenCalledWith(address, "?interval=5m&from=100&to=180&limit=1000");
    expect(result).toEqual({ bars: [{ time: 120_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 2.5 }], noData: false });
    const empty = await new Promise<boolean>((resolve, reject) => { void feed.getBars(cooketSymbol(token), "1", { from: 500, to: 600 }, (_bars, meta) => resolve(meta.noData), reject); });
    expect(empty).toBe(true);
    await new Promise<void>((resolve, reject) => { void feed.getBars(cooketSymbol(token), "1", { from: 0, to: 180, countBack: 2 }, () => resolve(), reject); });
    expect(fetch).toHaveBeenLastCalledWith(address, "?interval=1m&to=180&limit=2");
  });

  it("keeps sequential backward [from,to) requests adjacent and duplicate-free", async () => {
    const fetch = vi.fn(async (_address: string, query: string) => query.includes("from=60") ? page([point({ bucket_start: 60 })]) : page([point({ bucket_start: 120 })]));
    const feed = new CooketTradingViewDatafeed(token, fetch);
    const get = (from: number, to: number) => new Promise<ReturnType<typeof candleToTradingViewBar>[]>((resolve, reject) => {
      void feed.getBars(cooketSymbol(token), "1", { from, to }, (bars) => resolve(bars), reject);
    });
    const newer = await get(120, 180);
    const older = await get(60, 120);
    const times = [...older, ...newer].flatMap((bar) => bar ? [bar.time] : []);
    expect(times).toEqual([60_000, 120_000]);
    expect(new Set(times).size).toBe(times.length);
  });

  it("updates same buckets and uses reset rather than a backwards normal callback when a newest provisional bucket is removed", () => {
    const feed = new CooketTradingViewDatafeed(token, vi.fn());
    const bars: number[] = []; const reset = vi.fn();
    feed.subscribeBars(cooketSymbol(token), "1", (bar) => bars.push(bar.time), "one", reset);
    const later = trade({ identity: "5042002:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:2", log_index: 2, block_timestamp: 179, usdc_amount_raw: "3000000000000000000" });
    feed.syncRealtime([later, trade(), later]);
    feed.syncRealtime([later, trade(), later]);
    feed.syncRealtime([trade({ block_timestamp: 181 })]);
    feed.syncRealtime([]); // Phase 4 removal has already retracted the event from the shared stream.
    expect(bars).toEqual([120_000, 120_000, 180_000]);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("recomputes same-bucket removals but resets when the only newest provisional bucket disappears", () => {
    const feed = new CooketTradingViewDatafeed(token, vi.fn());
    const callback = vi.fn(); const reset = vi.fn();
    feed.subscribeBars(cooketSymbol(token), "1", callback, "one", reset);
    feed.reconcileCanonical("one", page([point({ bucket_start: 120, close_price: "1000000000000000000" })], 10));
    const first = trade({ block_number: 11, usdc_amount_raw: "2000000000000000000" });
    const second = trade({ identity: "5042002:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:2", transaction_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", log_index: 2, block_number: 12, usdc_amount_raw: "3000000000000000000" });
    feed.syncRealtime([first, second]); expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ time: 120_000, close: 3, volume: 7.5 }));
    feed.syncRealtime([first]); expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ time: 120_000, close: 2, volume: 4.5 }));
    feed.syncRealtime([]); expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ time: 120_000, close: 1 }));
    expect(reset).not.toHaveBeenCalled();
    feed.syncRealtime([trade({ block_number: 13, block_timestamp: 181 })]);
    feed.syncRealtime([]); expect(reset).toHaveBeenCalledOnce();
  });

  it("replaces acknowledged provisional bars from canonical snapshots and observes subscription lifecycle", () => {
    const feed = new CooketTradingViewDatafeed(token, vi.fn());
    const callback = vi.fn();
    feed.subscribeBars(cooketSymbol(token), "1", callback, "one");
    const live = trade({ block_number: 40 });
    feed.syncRealtime([live]);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ close: 2, volume: 2 }));
    feed.reconcileCanonical("one", page([point({ close_price: "2000000000000000000", volume: "2000000000000000000" })], 40));
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ close: 2, volume: 2 }));
    const count = callback.mock.calls.length;
    feed.unsubscribeBars("one"); feed.syncRealtime([live]);
    expect(callback).toHaveBeenCalledTimes(count);
  });

  it("rejects malformed history requests without issuing API traffic", async () => {
    const fetch = vi.fn(); const error = vi.fn(); const history = vi.fn();
    const feed = new CooketTradingViewDatafeed(token, fetch);
    for (const countBack of [NaN, Infinity, -1, 0, 1.5]) await feed.getBars(cooketSymbol(token), "1", { from: 0, to: 180, countBack }, history, error);
    expect(fetch).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledTimes(5);
  });

  it("ignores old interval and regressing snapshots during subscription reuse", () => {
    const feed = new CooketTradingViewDatafeed(token, vi.fn()); const callback = vi.fn();
    feed.subscribeBars(cooketSymbol(token), "5", callback, "chart");
    feed.reconcileCanonical("chart", page([point()], 40));
    expect(callback).not.toHaveBeenCalled();
    feed.reconcileCanonical("chart", { ...page([point({ bucket_start: 300 })], 40), interval: "5m" });
    expect(callback).toHaveBeenCalledOnce();
    feed.reconcileCanonical("chart", { ...page([point()], 39), interval: "5m" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("isolates multiple token addresses and accepts case-insensitive current-token events", () => {
    const feed = new CooketTradingViewDatafeed(token, vi.fn());
    const callback = vi.fn(); feed.subscribeBars(cooketSymbol(token), "1", callback, "one");
    feed.syncRealtime([trade({ token: address.toLowerCase() }), trade({ identity: "5042002:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:1", token: "0x1111111111111111111111111111111111111111" })]);
    expect(callback).toHaveBeenCalledOnce();
  });
});
