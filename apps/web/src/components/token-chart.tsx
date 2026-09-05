"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, LineStyle, type CandlestickData, type HistogramData, type Time } from "lightweight-charts";
import type { ChartInterval, ChartPoint } from "@cooket/types";
import { api } from "@/lib/api";
import { formatCompactNumber, presentationNumber } from "@/lib/format";
import { overlayCandles, reconcileRealtimeTrades, type RealtimeTrade } from "@/lib/token-realtime";

type CanonicalCandle = ChartPoint & { open_price: string; high_price: string; low_price: string; close_price: string };
type ChartView = "price" | "fdv";
type DisplayCandle = CandlestickData<Time> & { open: number; high: number; low: number; close: number };

export const TIMEFRAMES: readonly ChartInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
export const CANDLE_COLORS = {
  bullish: { body: "#10b981", wick: "#34d399", volume: "rgb(16 185 129 / 0.32)" },
  bearish: { body: "#f43f5e", wick: "#fb7185", volume: "rgb(244 63 94 / 0.32)" },
} as const;
export const PRICE_SCALE_MARGINS = { top: 0.08, bottom: 0.08 } as const;
export const PANE_STRETCH = { price: 0.78, volume: 0.22 } as const;
export const RIGHT_OFFSET_BARS = 4;
export const RECENT_VISIBLE_BARS: Readonly<Record<ChartInterval, number>> = { "1m": 100, "5m": 100, "15m": 96, "1h": 96, "4h": 90, "1d": 84, "1w": 80 };
// Sparse candles can be separated by long periods of inactivity. These
// interval-aware horizons frame the current trading regime by timestamp rather
// than assuming that a small number of buckets are contemporaneous.
export const RECENT_HORIZON_SECONDS: Readonly<Record<ChartInterval, number>> = {
  "1m": 6 * 60 * 60,
  "5m": 24 * 60 * 60,
  "15m": 3 * 24 * 60 * 60,
  "1h": 14 * 24 * 60 * 60,
  "4h": 42 * 24 * 60 * 60,
  "1d": 120 * 24 * 60 * 60,
  "1w": 365 * 24 * 60 * 60,
};
export const INTERVAL_SECONDS: Readonly<Record<ChartInterval, number>> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
// A session break is a substantial run of missing canonical buckets, scaled to
// the selected interval. The shorter intervals are deliberately conservative
// enough to distinguish a new active trading session from ordinary quietness.
export const INACTIVITY_GAP_BUCKETS: Readonly<Record<ChartInterval, number>> = { "1m": 180, "5m": 72, "15m": 48, "1h": 12, "4h": 24, "1d": 14, "1w": 8 };
export const SPARSE_FALLBACK_VISIBLE_BARS = 8;
export const SPARSE_LOGICAL_WIDTH = 24;

export type LogicalViewport = { from: number; to: number };

export function newestActiveClusterStart(interval: ChartInterval, bucketStarts: readonly number[]): number | null {
  const gapSeconds = INTERVAL_SECONDS[interval] * INACTIVITY_GAP_BUCKETS[interval];
  for (let index = bucketStarts.length - 1; index > 0; index -= 1) {
    const older = bucketStarts[index - 1];
    const newer = bucketStarts[index];
    if (Number.isFinite(older) && Number.isFinite(newer) && newer > older && newer - older > gapSeconds) return index;
  }
  return null;
}

export function defaultChartViewport(interval: ChartInterval, bucketStarts: readonly number[]): LogicalViewport | null {
  const barCount = bucketStarts.length;
  if (!Number.isSafeInteger(barCount) || barCount <= 0) return null;
  const target = RECENT_VISIBLE_BARS[interval];
  if (barCount >= target) return { from: barCount - target, to: barCount - 1 + RIGHT_OFFSET_BARS };

  const newestBucket = bucketStarts.at(-1);
  const cutoff = newestBucket !== undefined && Number.isFinite(newestBucket) ? newestBucket - RECENT_HORIZON_SECONDS[interval] : Number.POSITIVE_INFINITY;
  // The canonical endpoint returns ascending buckets. If an invalid timestamp
  // ever reaches this presentation boundary, safely show only the latest bar.
  const horizonStart = bucketStarts.findIndex((bucketStart) => Number.isFinite(bucketStart) && bucketStart >= cutoff);
  const clusterStart = newestActiveClusterStart(interval, bucketStarts);
  // A newest-session gap has priority. Without one, retain the age horizon but
  // cap sparse framing to recent actual candles rather than fitting all data.
  const fallbackStart = Math.max(0, barCount - SPARSE_FALLBACK_VISIBLE_BARS);
  const recentStart = clusterStart ?? Math.max(horizonStart === -1 ? barCount - 1 : horizonStart, fallbackStart);
  const visibleBars = barCount - recentStart;
  const emptySlots = Math.max(0, SPARSE_LOGICAL_WIDTH - visibleBars);

  // When the whole history is recent, center even one truthful weekly candle
  // in logical space. If older history exists, never pull it back in merely to
  // pad one-to-three recent bars.
  if (recentStart === 0) {
    const leftPadding = Math.floor(emptySlots / 2);
    return { from: -leftPadding, to: barCount - 1 + emptySlots - leftPadding };
  }

  // Earlier candles remain in the series and are reachable by left pan. The
  // right-side logical padding retains usable candle geometry without exposing
  // an obsolete price regime to the initial native autoscale.
  return { from: recentStart, to: barCount - 1 + emptySlots };
}

export function viewportFollowsLatest(range: LogicalViewport | null, barCount: number, tolerance = 2) {
  return range === null || barCount <= 0 || range.to >= barCount - 1 - tolerance;
}

export function shouldFollowAfterDataUpdate(isFollowingLatest: boolean, priorBarCount: number, nextBarCount: number) {
  return isFollowingLatest && priorBarCount !== nextBarCount;
}

function decimalPrice(value: string | null): value is string {
  return value !== null && /^\d+$/.test(value);
}

function completeCandle(point: ChartPoint): point is CanonicalCandle {
  return decimalPrice(point.open_price) && decimalPrice(point.high_price) && decimalPrice(point.low_price) && decimalPrice(point.close_price);
}

export function candleDirection(point: Pick<CanonicalCandle, "open_price" | "close_price">): "bullish" | "bearish" {
  return BigInt(point.close_price) >= BigInt(point.open_price) ? "bullish" : "bearish";
}

// Narrow adapter retained for exact direction/scaling regression coverage.
// Authoritative API strings remain untouched until this presentation boundary.
export function chartCandles(points: ChartPoint[]): { candles: CandlestickData<Time>[]; scale: bigint } {
  const complete = points.filter(completeCandle);
  if (complete.length === 0) return { candles: [], scale: BigInt(1) };
  const largest = complete.flatMap((point) => [point.open_price, point.high_price, point.low_price, point.close_price]).reduce((max, value) => BigInt(value) > max ? BigInt(value) : max, BigInt(0));
  const digits = largest.toString().length;
  const scale = digits > 12 ? BigInt(10) ** BigInt(digits - 12) : BigInt(1);
  return { scale, candles: complete.map((point) => {
    const colors = CANDLE_COLORS[candleDirection(point)];
    return { time: point.bucket_start as Time, open: Number(BigInt(point.open_price) / scale), high: Number(BigInt(point.high_price) / scale), low: Number(BigInt(point.low_price) / scale), close: Number(BigInt(point.close_price) / scale), color: colors.body, wickColor: colors.wick };
  }) };
}

export function chartDisplayData(points: ChartPoint[], view: ChartView, initialSupply: string | undefined) {
  const complete = points.filter(completeCandle);
  const priceValue = (value: string) => {
    let wei = BigInt(value);
    if (view === "fdv") {
      if (!initialSupply) return 0;
      wei = wei * BigInt(initialSupply) / BigInt(1_000_000_000_000_000_000);
    }
    return presentationNumber(wei);
  };
  const volumeValue = (value: string) => {
    return presentationNumber(BigInt(value));
  };
  return {
    candles: complete.map((point) => {
      const colors = CANDLE_COLORS[candleDirection(point)];
      return { time: point.bucket_start as Time, open: priceValue(point.open_price), high: priceValue(point.high_price), low: priceValue(point.low_price), close: priceValue(point.close_price), color: colors.body, wickColor: colors.wick } satisfies DisplayCandle;
    }),
    volumes: complete.map((point) => ({ time: point.bucket_start as Time, value: volumeValue(point.volume), color: CANDLE_COLORS[candleDirection(point)].volume } satisfies HistogramData<Time>)),
  };
}

export function headerCandle(candles: readonly DisplayCandle[], hoveredTime?: Time | null) {
  return (hoveredTime === null || hoveredTime === undefined ? undefined : candles.find((candle) => candle.time === hoveredTime)) ?? candles.at(-1) ?? null;
}

export function TokenChart({ tokenAddress, symbol = "TOKEN", initialSupply, realtimeEvents = [], onIndexedThroughBlock, className = "mt-10" }: { tokenAddress: string; symbol?: string; initialSupply?: string; realtimeEvents?: readonly RealtimeTrade[]; onIndexedThroughBlock?: (block: number | undefined) => void; className?: string }) {
  const pair = `${symbol.trim().replace(/^[$]+/, "").toUpperCase() || "TOKEN"} / USDC`;
  const container = useRef<HTMLDivElement>(null);
  const liveSeries = useRef<{ price: { setData: (data: CandlestickData<Time>[]) => void }; volume: { setData: (data: HistogramData<Time>[]) => void }; timeScale: { scrollToRealTime: () => void; setVisibleLogicalRange: (range: LogicalViewport) => void }; barCount: number } | null>(null);
  const followsLatest = useRef(true);
  const needsInitialViewport = useRef(false);
  const [timeframe, setTimeframe] = useState<ChartInterval>("5m");
  const [view, setView] = useState<ChartView>("price");
  const [inspectedTime, setInspectedTime] = useState<Time | null>(null);
  const query = useQuery({ queryKey: ["token-chart", tokenAddress, timeframe], queryFn: () => api.chart(tokenAddress, `?interval=${timeframe}&limit=500`), refetchInterval: 5_000 });
  const snapshotEvents = useMemo(() => reconcileRealtimeTrades(realtimeEvents, query.data?.indexed_through_block), [query.data?.indexed_through_block, realtimeEvents]);
  useEffect(() => { if (query.data?.indexed_through_block !== undefined) onIndexedThroughBlock?.(query.data.indexed_through_block); }, [onIndexedThroughBlock, query.data?.indexed_through_block, timeframe]);
  const chartData = useMemo(() => query.data ? chartDisplayData(overlayCandles(query.data.candles, snapshotEvents, timeframe), view, initialSupply) : { candles: [], volumes: [] }, [initialSupply, query.data, snapshotEvents, timeframe, view]);
  const displayedCandle = headerCandle(chartData.candles, inspectedTime);
  const hasChartData = chartData.candles.length > 0;

  useEffect(() => {
    const element = container.current;
    if (!element || !hasChartData) return;
    const formatValue = (value: number) => formatChartValue(value);
    const chart = createChart(element, {
      width: element.clientWidth,
      height: element.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "#0a0e18" }, textColor: "#a2aac0", fontFamily: "Geist, sans-serif" },
      grid: { vertLines: { color: "rgba(233, 238, 250, 0.09)" }, horzLines: { color: "rgba(233, 238, 250, 0.09)" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#6c7690", labelBackgroundColor: "#0d1322" }, horzLine: { color: "#6c7690", labelBackgroundColor: "#0d1322" } },
      rightPriceScale: { autoScale: true, borderColor: "rgba(233, 238, 250, 0.16)", scaleMargins: PRICE_SCALE_MARGINS },
      timeScale: { borderColor: "rgba(233, 238, 250, 0.16)", timeVisible: true, secondsVisible: false, rightOffset: RIGHT_OFFSET_BARS, barSpacing: 9, minBarSpacing: 3, fixLeftEdge: false, fixRightEdge: false },
      localization: { priceFormatter: formatValue },
    });
    const priceSeries = chart.addSeries(CandlestickSeries, {
      upColor: CANDLE_COLORS.bullish.body,
      downColor: CANDLE_COLORS.bearish.body,
      borderVisible: false,
      wickVisible: true,
      wickUpColor: CANDLE_COLORS.bullish.wick,
      wickDownColor: CANDLE_COLORS.bearish.wick,
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dashed,
      priceLineColor: "rgba(34, 211, 238, 0.55)",
      priceFormat: { type: "custom", minMove: 0.000000000001, formatter: formatValue },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "right",
      priceFormat: { type: "custom", minMove: 0.00000001, formatter: (value: number) => `$${formatCompactNumber(value)}` },
      lastValueVisible: false,
      priceLineVisible: false,
    }, 1);
    const panes = chart.panes();
    panes[0]?.setStretchFactor(PANE_STRETCH.price);
    panes[1]?.setStretchFactor(PANE_STRETCH.volume);
    volumeSeries.priceScale().applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: 0 }, borderVisible: false });
    const timeScale = chart.timeScale();
    liveSeries.current = { price: priceSeries, volume: volumeSeries, timeScale, barCount: 0 };
    needsInitialViewport.current = true;
    followsLatest.current = true;
    const observeViewport = (range: LogicalViewport | null) => { followsLatest.current = viewportFollowsLatest(range, liveSeries.current?.barCount ?? 0); };
    timeScale.subscribeVisibleLogicalRangeChange(observeViewport);
    chart.subscribeCrosshairMove((params) => {
      if (!params.time || !params.point || params.point.x < 0 || params.point.y < 0 || params.point.x > element.clientWidth || params.point.y > element.clientHeight) {
        setInspectedTime(null);
        return;
      }
      const candle = params.seriesData.get(priceSeries) as DisplayCandle | undefined;
      setInspectedTime(candle && "open" in candle ? candle.time : null);
    });
    const resize = () => chart.applyOptions({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => { timeScale.unsubscribeVisibleLogicalRangeChange(observeViewport); liveSeries.current = null; observer.disconnect(); chart.remove(); };
  }, [hasChartData, timeframe, tokenAddress, view]);

  useEffect(() => {
    const current = liveSeries.current;
    if (!current) return;
    const priorCount = current.barCount;
    const shouldFollow = followsLatest.current;
    current.barCount = chartData.candles.length;
    current.price.setData(chartData.candles);
    current.volume.setData(chartData.volumes);
    if (needsInitialViewport.current) {
      const initialViewport = defaultChartViewport(timeframe, chartData.candles.map((candle) => Number(candle.time)));
      if (initialViewport) current.timeScale.setVisibleLogicalRange(initialViewport);
      needsInitialViewport.current = false;
      return;
    }
    if (shouldFollowAfterDataUpdate(shouldFollow, priorCount, chartData.candles.length)) current.timeScale.scrollToRealTime();
  }, [chartData.candles, chartData.volumes, timeframe]);

  const controls = <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-center">
    <div className="flex min-w-0 items-center gap-2">
      <label className="sr-only" htmlFor={`chart-metric-${tokenAddress}`}>Chart metric</label>
      <select id={`chart-metric-${tokenAddress}`} aria-label="Chart metric" value={view} className="min-h-11 flex-1 rounded-lg border border-white/10 bg-[#0d1322] px-3 text-xs font-semibold text-zinc-200 outline-none transition focus:border-cyan-300/50 sm:min-h-9 sm:flex-none" onChange={(event) => { setInspectedTime(null); setView(event.target.value as ChartView); }}>
        <option value="price">Price</option>
        <option value="fdv" disabled={!initialSupply}>FDV</option>
      </select>
      <label className="sr-only" htmlFor={`chart-timeframe-${tokenAddress}`}>Chart timeframe</label>
      <select id={`chart-timeframe-${tokenAddress}`} aria-label="Chart timeframe" value={timeframe} className="min-h-11 flex-1 rounded-lg border border-white/10 bg-[#0d1322] px-3 text-xs font-semibold text-zinc-200 outline-none transition focus:border-cyan-300/50 sm:min-h-9 sm:flex-none" onChange={(event) => { setInspectedTime(null); onIndexedThroughBlock?.(undefined); setTimeframe(event.target.value as ChartInterval); }}>
        {TIMEFRAMES.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </div>
    <div className="safe-scroll -mx-1 flex gap-1 px-1 sm:hidden" role="group" aria-label="Chart timeframes">
      {TIMEFRAMES.map((item) => <button key={item} type="button" aria-pressed={timeframe === item} className={`min-h-11 min-w-11 flex-none rounded-lg px-3 text-xs font-semibold ${timeframe === item ? "bg-cyan-300/12 text-cyan-200" : "text-zinc-500"}`} onClick={() => { setInspectedTime(null); onIndexedThroughBlock?.(undefined); setTimeframe(item); }}>{item}</button>)}
    </div>
  </div>;

  if (query.isPending) return <ChartState className={className} controls={controls} pair={pair} copy={`Loading ${timeframe} chart…`} loading />;
  if (query.isError) return <ChartState className={className} controls={controls} pair={pair} copy="Historical prices could not be loaded." error />;
  if (chartData.candles.length === 0) return <ChartState className={className} controls={controls} pair={pair} copy={`No trades in this timeframe yet.`} />;
  return <section className={`terminal-panel min-w-0 overflow-hidden ${className}`} aria-label="Price history">
    <div className="flex min-w-0 flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-white">{pair}</h2>
        <details className="mt-1 text-xs text-zinc-500"><summary>Candle details</summary><div className="flex flex-wrap gap-3 py-2">
          <OHLCValue label="O" value={displayedCandle ? formatChartValue(displayedCandle.open) : "—"} />
          <OHLCValue label="H" value={displayedCandle ? formatChartValue(displayedCandle.high) : "—"} />
          <OHLCValue label="L" value={displayedCandle ? formatChartValue(displayedCandle.low) : "—"} />
          <OHLCValue label="C" value={displayedCandle ? formatChartValue(displayedCandle.close) : "—"} />
          </div></details>
      </div>
      {controls}
    </div>
    <div className="bg-[#0a0e18]"><div ref={container} className="h-[min(16.5rem,46dvh)] w-full min-[390px]:h-[min(18.5rem,48dvh)] sm:h-[28rem] lg:h-[40rem] xl:h-[44rem]" role="img" aria-label={`${view === "price" ? "Price" : "FDV"} candlestick chart with volume`} /></div>
    <p className="border-t border-white/8 px-4 py-3 text-xs leading-5 text-zinc-600">Volume</p>
  </section>;
}

function OHLCValue({ label, value }: { label: "O" | "H" | "L" | "C"; value: string }) {
  return <span className="whitespace-nowrap"><span className="text-zinc-600">{label}</span> <span className="text-zinc-200">{value}</span></span>;
}

function ChartState({ copy, controls, pair, error = false, loading = false, className }: { copy: string; controls: React.ReactNode; pair: string; error?: boolean; loading?: boolean; className: string }) {
  return <section className={`terminal-panel ${className}`} aria-label="Price history"><div className="flex min-w-0 flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold text-white">{pair}</h2></div>{controls}</div><p className={`m-4 text-sm ${error ? "text-red-300" : "text-zinc-400"}`}>{copy}</p>{loading && <div className="skeleton m-4 h-52 rounded-xl sm:h-80" />}</section>;
}

export function formatChartValue(value: number) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute === 0) return "$0";
  if (absolute >= 1_000) return `$${formatCompactNumber(value)}`;
  if (absolute < 0.00000001) return value > 0 ? "<$0.00000001" : ">$0.00000001";
  return `$${trimFixed(value, absolute >= 1 ? 4 : 8)}`;
}

function trimFixed(value: number, digits: number) {
  return value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}
