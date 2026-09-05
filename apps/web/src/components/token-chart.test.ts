import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChartPoint } from "@cooket/types";
import { CANDLE_COLORS, INACTIVITY_GAP_BUCKETS, INTERVAL_SECONDS, PANE_STRETCH, PRICE_SCALE_MARGINS, RECENT_HORIZON_SECONDS, RECENT_VISIBLE_BARS, RIGHT_OFFSET_BARS, SPARSE_FALLBACK_VISIBLE_BARS, SPARSE_LOGICAL_WIDTH, candleDirection, chartCandles, chartDisplayData, defaultChartViewport, formatChartValue, headerCandle, newestActiveClusterStart, shouldFollowAfterDataUpdate, TIMEFRAMES, viewportFollowsLatest } from "./token-chart";

const point = (overrides: Partial<ChartPoint>): ChartPoint => ({
  bucket_start: 60,
  trade_count: 3,
  buy_count: 2,
  sell_count: 1,
  volume: "3000000000000000000",
  unique_trader_count: 2,
  open_price: "100",
  high_price: "110",
  low_price: "70",
  close_price: "80",
  ...overrides,
});

const bucketStarts = (count: number, seconds = 60, start = 0) => Array.from({ length: count }, (_, index) => start + index * seconds);

describe("canonical chart presentation", () => {
  it("renders only complete OHLC records with a bounded presentation scale", () => {
    const { candles, scale } = chartCandles([
      point({ bucket_start: 3600, open_price: "1000000000000000000", high_price: "3000000000000000000", low_price: "1000000000000000000", close_price: "2000000000000000000" }),
      point({ bucket_start: 7200, open_price: null, high_price: null, low_price: null, close_price: null }),
    ]);
    expect(scale).toBe(BigInt(10_000_000));
    expect(candles).toEqual([{ time: 3600, open: 100_000_000_000, high: 300_000_000_000, low: 100_000_000_000, close: 200_000_000_000, color: CANDLE_COLORS.bullish.body, wickColor: CANDLE_COLORS.bullish.wick }]);
  });

  it("uses exact OHLC direction even when trade-count dominance says the opposite", () => {
    const bearish = point({ open_price: "100", high_price: "110", low_price: "70", close_price: "80", buy_count: 9, sell_count: 1 });
    const bullish = point({ bucket_start: 120, open_price: "80", high_price: "110", low_price: "70", close_price: "100", buy_count: 1, sell_count: 9 });
    const { candles } = chartCandles([bearish, bullish]);

    expect(candleDirection({ open_price: "100", close_price: "80" })).toBe("bearish");
    expect(candleDirection({ open_price: "80", close_price: "100" })).toBe("bullish");
    expect(candles[0]).toMatchObject({ open: 100, close: 80, color: CANDLE_COLORS.bearish.body, wickColor: CANDLE_COLORS.bearish.wick });
    expect(candles[1]).toMatchObject({ open: 80, close: 100, color: CANDLE_COLORS.bullish.body, wickColor: CANDLE_COLORS.bullish.wick });
  });

  it("colors volume from OHLC direction rather than buy/sell counts", () => {
    const bearish = point({ buy_count: 99, sell_count: 1, open_price: "100", close_price: "80" });
    const bullish = point({ bucket_start: 120, buy_count: 1, sell_count: 99, open_price: "80", close_price: "100" });
    const data = chartDisplayData([bearish, bullish], "price", undefined);
    expect(data.volumes.map(({ color }) => color)).toEqual([CANDLE_COLORS.bearish.volume, CANDLE_COLORS.bullish.volume]);
  });

  it("defaults header OHLC to the latest candle and temporarily prefers a hovered candle", () => {
    const data = chartDisplayData([point({ bucket_start: 60 }), point({ bucket_start: 120, open_price: "80", high_price: "130", low_price: "75", close_price: "120" })], "price", undefined);
    expect(headerCandle(data.candles)).toBe(data.candles[1]);
    expect(headerCandle(data.candles, data.candles[0].time)).toBe(data.candles[0]);
    expect(headerCandle(data.candles, null)).toBe(data.candles[1]);
  });

  it("preserves Price/FDV conversion and supported backend intervals", () => {
    const candle = point({ open_price: "1000000000000000000", high_price: "1000000000000000000", low_price: "1000000000000000000", close_price: "1000000000000000000" });
    const price = chartDisplayData([candle], "price", "1000000000000000000000");
    const fdv = chartDisplayData([candle], "fdv", "1000000000000000000000");
    expect(price.candles[0].close).toBe(1);
    expect(fdv.candles[0].close).toBe(1000);
    expect(TIMEFRAMES).toEqual(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);
  });

  it("uses native visible-range autoscale margins and a secondary volume pane", () => {
    expect(PRICE_SCALE_MARGINS).toEqual({ top: 0.08, bottom: 0.08 });
    expect(PANE_STRETCH).toEqual({ price: 0.78, volume: 0.22 });
  });

  it("frames a bounded recent window for every interval and keeps the newest bar plus right breathing room", () => {
    expect(Object.keys(RECENT_VISIBLE_BARS)).toEqual(TIMEFRAMES);
    for (const interval of TIMEFRAMES) {
      const range = defaultChartViewport(interval, bucketStarts(500))!;
      expect(range.from).toBe(500 - RECENT_VISIBLE_BARS[interval]);
      expect(range.to).toBe(499 + RIGHT_OFFSET_BARS);
      expect(viewportFollowsLatest(range, 500)).toBe(true);
    }
  });

  it("centers one to three truthful candles in generous logical space", () => {
    expect(defaultChartViewport("1m", bucketStarts(1))).toEqual({ from: -11, to: 12 });
    expect(defaultChartViewport("1m", bucketStarts(2))).toEqual({ from: -11, to: 12 });
    expect(defaultChartViewport("1m", bucketStarts(3))).toEqual({ from: -10, to: 13 });
    expect(defaultChartViewport("5m", [])).toBeNull();
  });

  it("uses interval-aware timestamp horizons and scaled inactivity thresholds", () => {
    expect(SPARSE_LOGICAL_WIDTH).toBe(24);
    expect(INACTIVITY_GAP_BUCKETS).toEqual({ "1m": 180, "5m": 72, "15m": 48, "1h": 12, "4h": 24, "1d": 14, "1w": 8 });
    const newest = 2_000_000_000;
    for (const interval of TIMEFRAMES) {
      const oldThenLatest = [newest - RECENT_HORIZON_SECONDS[interval] - 1, newest];
      expect(defaultChartViewport(interval, oldThenLatest)).toEqual({ from: 1, to: 24 });
    }
  });

  it.each(["1m", "5m", "15m"] as const)("uses the newest sparse %s active cluster even when the old regime is inside its age horizon", (interval) => {
    const newest = 2_000_000_000;
    const step = INTERVAL_SECONDS[interval];
    const currentClusterStart = newest - 5 * step;
    const oldClusterEnd = currentClusterStart - (INACTIVITY_GAP_BUCKETS[interval] + 1) * step;
    const source = Array.from({ length: 8 }, (_, index) => point({
      bucket_start: index < 2 ? oldClusterEnd - (1 - index) * step : newest - (7 - index) * step,
      open_price: index < 2 ? "35000000000000" : "12090000000000",
      high_price: index < 2 ? "40000000000000" : "12120000000000",
      low_price: index < 2 ? "35000000000000" : "12070000000000",
      close_price: index < 2 ? "39000000000000" : "12090000000000",
    }));
    const before = structuredClone(source);
    const display = chartDisplayData(source, "price", undefined);
    const range = defaultChartViewport(interval, source.map(({ bucket_start }) => bucket_start))!;

    expect(source[1].bucket_start).toBeGreaterThan(newest - RECENT_HORIZON_SECONDS[interval]);
    expect(newestActiveClusterStart(interval, source.map(({ bucket_start }) => bucket_start))).toBe(2);
    expect(range).toEqual({ from: 2, to: 25 });
    expect(range.from).toBeGreaterThan(1); // indices 0-1 are outside initial native autoscale
    expect(display.candles).toHaveLength(8); // left pan can still reach every historical candle
    expect(display.candles.slice(0, 2).map((candle) => candle.high)).toEqual([0.00004, 0.00004]);
    expect(display.candles.slice(2).every((candle) => candle.high < 0.000013)).toBe(true);
    expect(source).toEqual(before);
  });

  it("falls back to the latest bounded actual bars when sparse history has no session break", () => {
    expect(SPARSE_FALLBACK_VISIBLE_BARS).toBe(8);
    for (const interval of TIMEFRAMES) {
      const buckets = bucketStarts(12, INTERVAL_SECONDS[interval], 2_000_000_000);
      expect(newestActiveClusterStart(interval, buckets)).toBeNull();
      expect(defaultChartViewport(interval, buckets)).toEqual({ from: 4, to: 27 });
    }
  });

  it("frames the Arc Meow 1h current cluster after its observed 17-hour inactivity gap", () => {
    const timestamps = [1788519600, 1788523200, 1788534000, 1788537600, 1788541200, 1788544800, 1788548400, 1788609600, 1788624000];
    const source = timestamps.map((bucket_start, index) => point({
      bucket_start,
      volume: `${index + 1}000000000000000000`,
      open_price: index === 2 ? "27172500000000" : index === 3 ? "37090909090909" : index >= 7 ? "12200000000000" : "1512522087674",
      high_price: index === 2 ? "27172500000000" : index === 3 ? "37090909090909" : index === 7 ? "12231811471010" : index === 8 ? "12341154056675" : "1512522087674",
      low_price: index >= 7 ? "11892337736115" : "1512522087674",
      close_price: index >= 7 ? "12201767806765" : "1512522087674",
    }));
    const before = structuredClone(source);
    const display = chartDisplayData(source, "price", undefined);
    const range = defaultChartViewport("1h", timestamps)!;

    expect((timestamps[7] - timestamps[6]) / INTERVAL_SECONDS["1h"]).toBe(17);
    expect(newestActiveClusterStart("1h", timestamps)).toBe(7);
    expect(range).toEqual({ from: 7, to: 30 });
    expect(display.candles).toHaveLength(9); // indices 0-6 remain available through left pan
    expect(display.candles.slice(2, 4).map((candle) => candle.high)).toEqual([0.0000271725, 0.000037090909090909]);
    expect(display.candles.slice(-2).every((candle) => candle.high < 0.000013)).toBe(true);
    expect(display.volumes).toHaveLength(9);
    expect(source).toEqual(before);
  });

  it("pads one, two, three, or six recent candles without reintroducing older sparse regimes", () => {
    const newest = 2_000_000_000;
    for (const recentCount of [1, 2, 3, 6]) {
      const buckets = [newest - RECENT_HORIZON_SECONDS["5m"] - 600, newest - RECENT_HORIZON_SECONDS["5m"] - 300, ...bucketStarts(recentCount, 300, newest - (recentCount - 1) * 300)];
      expect(defaultChartViewport("5m", buckets)).toEqual({ from: 2, to: 25 });
    }
  });

  it("uses the existing 80-100 recent-bar policy once history is sufficiently deep", () => {
    for (const interval of TIMEFRAMES) {
      const target = RECENT_VISIBLE_BARS[interval];
      expect(defaultChartViewport(interval, bucketStarts(target + 1))).toEqual({ from: 1, to: target + RIGHT_OFFSET_BARS });
    }
  });

  it("follows rollovers only while the user remains at the realtime edge", () => {
    expect(viewportFollowsLatest({ from: 400, to: 503 }, 500)).toBe(true);
    expect(viewportFollowsLatest({ from: 100, to: 200 }, 500)).toBe(false);
    expect(shouldFollowAfterDataUpdate(true, 100, 101)).toBe(true);
    expect(shouldFollowAfterDataUpdate(true, 100, 100)).toBe(false); // same-bucket realtime or canonical refresh
    expect(shouldFollowAfterDataUpdate(false, 100, 101)).toBe(false); // intentional historical pan
  });

  it("does not mutate sparse or full OHLC records while deriving display data", () => {
    const source = [point({ open_price: "12090000000000", high_price: "12090000000000", low_price: "12090000000000", close_price: "12090000000000" })];
    const before = structuredClone(source);
    expect(chartDisplayData(source, "price", undefined).candles[0]).toMatchObject({ open: 0.00001209, high: 0.00001209, low: 0.00001209, close: 0.00001209 });
    expect(source).toEqual(before);
  });

  it("keeps tiny non-zero prices readable", () => {
    expect(formatChartValue(0.00001209)).toBe("$0.00001209");
    expect(formatChartValue(0.00000247)).toBe("$0.00000247");
    expect(formatChartValue(0.0000000009375)).toBe("<$0.00000001");
  });

  it("does not send malformed or negative prices to the chart", () => {
    const data = chartDisplayData([
      point({ open_price: "-1" as never, high_price: "2", low_price: "-1" as never, close_price: "1" }),
      point({ bucket_start: 120, open_price: "0", high_price: "2", low_price: "0", close_price: "1" }),
    ], "price", undefined);
    expect(data.candles).toHaveLength(1);
    expect(data.candles[0]).toMatchObject({ open: 0, low: 0, close: 1e-18 });
  });

  it("does not describe or implement trade-count candle coloring", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/token-chart.tsx"), "utf8");
    expect(source).not.toContain("fitContent()");
    expect(source).toContain("setVisibleLogicalRange(initialViewport)");
    expect(source).toContain("[hasChartData, timeframe, tokenAddress, view]");
    expect(source).not.toContain("green buy-dominant, red sell-dominant");
    expect(source).not.toContain("sell_count > buy_count");
    expect(source).not.toContain("candleTradeSide");
  });
});
