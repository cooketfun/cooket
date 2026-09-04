import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChartPoint } from "@cooket/types";
import { CANDLE_COLORS, PANE_STRETCH, PRICE_SCALE_MARGINS, candleDirection, chartCandles, chartDisplayData, formatChartValue, headerCandle, TIMEFRAMES } from "./token-chart";

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

  it("keeps tiny non-zero prices readable", () => {
    expect(formatChartValue(0.0000000009375, "USDC")).toBe("9.375e-10 USDC");
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
    expect(source).not.toContain("green buy-dominant, red sell-dominant");
    expect(source).not.toContain("sell_count > buy_count");
    expect(source).not.toContain("candleTradeSide");
  });
});
