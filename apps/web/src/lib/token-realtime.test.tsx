import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Token, Trade } from "@cooket/types";
import { advanceRealtimeSurfaceWatermark, overlayCandles, overlayMetrics, parseRealtimeTrade, reconcileRealtimeTrades, realtimePrice, realtimeVolume, safeRealtimeRetirementFloor, useTokenRealtimeTrades, type RealtimeTrade } from "./token-realtime";

const tokenAddress = "0x5B95B40217864B8F1793aF848a0A141E1e23aF1e";
const event = (overrides: Partial<RealtimeTrade> = {}): RealtimeTrade => ({ identity: "5042002:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:7", chain_id: 5042002, token: tokenAddress, market: "0x1111111111111111111111111111111111111111", source: "curve", side: "buy", block_number: 20, block_timestamp: 120, transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", log_index: 7, removed: false, received_at: "not-used-for-buckets", token_amount_raw: "100000000000000000000", usdc_amount_raw: "2000000000000000000", usdc_decimals: 18, raw_fields: { buyer: "0x2222222222222222222222222222222222222222" }, ...overrides });
const canonicalToken = (): Token => ({ address: tokenAddress, creator: tokenAddress, name: "Cooket", symbol: "COOK", initial_supply: "1000000000000000000000000000", created_at: { block_number: 1, transaction_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", log_index: 1 }, metrics: { trade_count: 2, buy_count: 1, sell_count: 1, volume: "1000000000000000000", fees: "0", unique_trader_count: 1, latest_trade_timestamp: null, current_price: "1", fully_diluted_value: "1", holder_count: 1 } });

describe("realtime trade normalization", () => {
  it("aligns weekly provisional volume with the API Monday bucket", () => {
    const monday = 1788134400; // 2026-08-31 00:00 UTC
    const live = event({ block_timestamp: monday + 6 * 86400 });
    const canonical = overlayCandles([], [event({ block_timestamp: monday })], "1w");
    const result = overlayCandles(canonical, [live], "1w");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ bucket_start: monday, trade_count: 2, volume: "4000000000000000000" });
  });

  it("rejects invalid watermark proof and handles every asymmetric ordering", () => {
    for (const invalid of [NaN, Infinity, -1, 1.5]) {
      expect(safeRealtimeRetirementFloor({ token: 40, chart: invalid, trades: 40 })).toBeUndefined();
      expect(advanceRealtimeSurfaceWatermark({ chart: 39 }, "chart", invalid)).toEqual({ chart: 39 });
    }
    for (const token of [39, 40]) for (const chart of [39, 40]) for (const trades of [39, 40]) {
      expect(safeRealtimeRetirementFloor({ token, chart, trades })).toBe(Math.min(token, chart, trades));
    }
  });
  it("accepts case-insensitive matching events and rejects invalid chain, token, source, side, malformed data, or normal events without block time", () => {
    expect(parseRealtimeTrade({ ...event(), token: tokenAddress.toLowerCase() }, tokenAddress)?.identity).toBe(event().identity);
    for (const invalid of [{ ...event(), chain_id: 1 }, { ...event(), token: "0x0000000000000000000000000000000000000000" }, { ...event(), source: "other" }, { ...event(), side: "hold" }, { ...event(), block_timestamp: undefined }, { nope: true }]) expect(parseRealtimeTrade(invalid, tokenAddress)).toBeNull();
    expect(parseRealtimeTrade({ ...event(), removed: true, block_timestamp: undefined }, tokenAddress)?.removed).toBe(true);
  });

  it("uses exact bigint price and normalizes both native and V3 USDC volume", () => {
    expect(realtimePrice(event())).toBe(BigInt("20000000000000000"));
    expect(realtimeVolume(event())).toBe(BigInt("2000000000000000000"));
    const v3 = event({ source: "uniswap_v3", usdc_decimals: 6, usdc_amount_raw: "2000000", token_amount_raw: "100000000000000000000" });
    expect(realtimePrice(v3)).toBe(BigInt("20000000000000000"));
    expect(realtimeVolume(v3)).toBe(BigInt("2000000000000000000"));
  });

  it("reconciles canonical identities and orders closes by chain ordering rather than arrival", () => {
    const first = event({ identity: "5042002:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:1", transaction_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", log_index: 1, block_timestamp: 60, token_amount_raw: "1000000000000000000", usdc_amount_raw: "1000000000000000000" });
    const later = event({ identity: "5042002:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:2", block_timestamp: 60, block_number: 21, log_index: 2, token_amount_raw: "1000000000000000000", usdc_amount_raw: "3000000000000000000" });
    const canonical = [{ transaction_hash: later.transaction_hash, log_index: later.log_index } as Trade];
    expect(reconcileRealtimeTrades([later, first], undefined, canonical)).toEqual([first]);
    const candles = overlayCandles([], [later, first], "1m");
    expect(candles[0]).toMatchObject({ open_price: "1000000000000000000", close_price: "3000000000000000000", high_price: "3000000000000000000", volume: "4000000000000000000", trade_count: 2 });
  });

  it("recomputes metrics and candles from the remaining overlay after removal", () => {
    const live = event();
    expect(overlayMetrics(canonicalToken(), [live])).toMatchObject({ current_price: "20000000000000000", volume: "3000000000000000000", trade_count: 3, fully_diluted_value: "20000000000000000000000000" });
    const candles = overlayCandles([{ bucket_start: 120, trade_count: 1, buy_count: 1, sell_count: 0, volume: "1", unique_trader_count: 1, open_price: "10", high_price: "10", low_price: "10", close_price: "10" }], [live], "1m");
    expect(candles[0]).toMatchObject({ trade_count: 2, close_price: "20000000000000000" });
    expect(overlayCandles([], [event({ block_timestamp: 301 })], "5m")[0]?.bucket_start).toBe(300);
  });

  it("uses each canonical snapshot watermark to prevent chart/metrics double counting", () => {
    const live = event({ block_number: 40, block_timestamp: 120 });
    const chartSnapshot = reconcileRealtimeTrades([live], 40);
    const staleTradesSnapshot = reconcileRealtimeTrades([live], 39);
    expect(chartSnapshot).toEqual([]);
    expect(overlayCandles([{ bucket_start: 120, trade_count: 1, buy_count: 1, sell_count: 0, volume: "2000000000000000000", unique_trader_count: 1, open_price: "20000000000000000", high_price: "20000000000000000", low_price: "20000000000000000", close_price: "20000000000000000" }], chartSnapshot, "1m")[0]?.trade_count).toBe(1);
    expect(overlayMetrics(canonicalToken(), reconcileRealtimeTrades([live], 40)).trade_count).toBe(2);
    expect(staleTradesSnapshot).toEqual([live]);
  });

  it("uses the minimum of all available canonical surfaces as the only retirement floor", () => {
    expect(safeRealtimeRetirementFloor({ token: 39, chart: 40, trades: 39 })).toBe(39);
    expect(safeRealtimeRetirementFloor({ token: 40, chart: 39, trades: 39 })).toBe(39);
    expect(safeRealtimeRetirementFloor({ token: 40, chart: 40, trades: 40 })).toBe(40);
    expect(safeRealtimeRetirementFloor({ token: 40, chart: 40 })).toBeUndefined();
  });

  it("advances each surface monotonically and requires a fresh chart snapshot after a timeframe change", () => {
    const token = advanceRealtimeSurfaceWatermark({ token: 40 }, "token", 39);
    expect(token).toEqual({ token: 40 });
    const chart = advanceRealtimeSurfaceWatermark({ token: 40, chart: 40, trades: 40 }, "chart", undefined);
    expect(chart).toEqual({ token: 40, trades: 40 });
    expect(safeRealtimeRetirementFloor(chart)).toBeUndefined();
    expect(advanceRealtimeSurfaceWatermark(chart, "chart", 39)).toEqual({ token: 40, chart: 39, trades: 40 });
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, EventListener>(); close = vi.fn();
  constructor(public readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(name: string, listener: EventListener) { this.listeners.set(name, listener); }
  removeEventListener(name: string) { this.listeners.delete(name); }
  emit(data: unknown) { this.listeners.get("trade")?.({ data: JSON.stringify(data) } as MessageEvent); }
}
afterEach(() => { FakeEventSource.instances = []; vi.restoreAllMocks(); });

describe("EventSource lifecycle", () => {
  it("isolates token navigation and ignores a queued callback after cleanup", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const nextToken = "0x1111111111111111111111111111111111111111";
    const hook = renderHook(({ token, floor }) => useTokenRealtimeTrades(token, floor, "http://realtime.test"), { initialProps: { token: tokenAddress, floor: 100 } });
    const old = FakeEventSource.instances[0]!;
    const stale = old.listeners.get("trade")!;
    hook.rerender({ token: nextToken, floor: 0 });
    act(() => { stale({ data: JSON.stringify(event({ block_number: 101 })) } as MessageEvent); FakeEventSource.instances[1]!.emit(event({ token: nextToken })); });
    expect(old.close).toHaveBeenCalledOnce();
    expect(hook.result.current.map((item) => item.token)).toEqual([nextToken]);
    hook.unmount();
    expect(FakeEventSource.instances[1]!.close).toHaveBeenCalledOnce();
  });

  it("handles 10000 duplicate deliveries as one contribution, then retracts and retires", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const hook = renderHook(({ floor }) => useTokenRealtimeTrades(tokenAddress, floor, "http://realtime.test"), { initialProps: { floor: 0 } });
    const source = FakeEventSource.instances[0]!;
    act(() => { for (let i = 0; i < 10000; i++) source.emit(event()); });
    expect(hook.result.current).toHaveLength(1);
    expect(overlayCandles([], hook.result.current, "1m")[0].trade_count).toBe(1);
    act(() => source.emit(event({ removed: true })));
    expect(overlayCandles([], hook.result.current, "1m")).toEqual([]);
    hook.rerender({ floor: 20 });
    act(() => source.emit(event()));
    expect(hook.result.current).toEqual([]);
    hook.unmount();
  });
  it("opens one token stream, deduplicates/retracts, and closes on unmount", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const hook = renderHook(() => useTokenRealtimeTrades(tokenAddress, 0, "http://realtime.test"));
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("http://realtime.test/events");
    act(() => { source.emit(event()); source.emit(event()); }); expect(hook.result.current).toHaveLength(1);
    act(() => source.emit(event({ removed: true, block_timestamp: undefined }))); expect(hook.result.current).toEqual([]);
    hook.unmount(); expect(source.close).toHaveBeenCalledOnce();
  });

  it("permanently retires an acknowledged identity instead of resurrecting it after a bounded list ages out", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const hook = renderHook(({ watermark }) => useTokenRealtimeTrades(tokenAddress, watermark, "http://realtime.test"), { initialProps: { watermark: 0 } });
    const source = FakeEventSource.instances[0]!;
    act(() => source.emit(event({ block_number: 40 }))); expect(hook.result.current).toHaveLength(1);
    hook.rerender({ watermark: 40 }); expect(hook.result.current).toEqual([]);
    hook.rerender({ watermark: 0 }); act(() => source.emit(event({ block_number: 40 })));
    expect(hook.result.current).toEqual([]);
  });

  it("uses the all-surface retirement floor instead of a fresh chart watermark", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const live = event({ block_number: 40 });
    const hook = renderHook(({ floor }) => useTokenRealtimeTrades(tokenAddress, floor, "http://realtime.test"), { initialProps: { floor: undefined as number | undefined } });
    act(() => FakeEventSource.instances[0]!.emit(live)); expect(hook.result.current).toEqual([live]);
    // token=39, chart=40, trades=39: the floor is 39, so only chart retires A.
    let watermarks = { token: 39, chart: 40, trades: 39 };
    hook.rerender({ floor: safeRealtimeRetirementFloor(watermarks) });
    expect(hook.result.current).toEqual([live]);
    expect(reconcileRealtimeTrades(hook.result.current, 39)).toEqual([live]);
    expect(reconcileRealtimeTrades(hook.result.current, 40)).toEqual([]);
    expect(overlayMetrics(canonicalToken(), reconcileRealtimeTrades(hook.result.current, 39)).trade_count).toBe(3);
    // The inverse ordering is equally important: token can be canonical before
    // chart and trades, without deleting their provisional copy from storage.
    expect(overlayMetrics(canonicalToken(), reconcileRealtimeTrades(hook.result.current, 40)).trade_count).toBe(2);
    expect(reconcileRealtimeTrades(hook.result.current, 39)).toEqual([live]);
    // Once every snapshot reaches 40, shared storage retires it permanently.
    watermarks = { token: 40, chart: 40, trades: 40 };
    hook.rerender({ floor: safeRealtimeRetirementFloor(watermarks) }); expect(hook.result.current).toEqual([]);
    act(() => FakeEventSource.instances[0]!.emit(live)); expect(hook.result.current).toEqual([]);
  });
});
