"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, type CandlestickData, type HistogramData, type Time } from "lightweight-charts";
import type { ChartInterval, ChartPoint } from "@cooket/types";
import { api } from "@/lib/api";
import { presentationNumber, weiToUsdUnits, type EthUsdReference } from "@/lib/format";
import { useOraclePrice } from "@/providers/oracle-price-provider";

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

export function chartDisplayData(points: ChartPoint[], view: ChartView, initialSupply: string | undefined, reference: EthUsdReference | null) {
  const complete = points.filter(completeCandle);
  const priceValue = (value: string) => {
    let wei = BigInt(value);
    if (view === "fdv") {
      if (!initialSupply) return 0;
      wei = wei * BigInt(initialSupply) / BigInt(1_000_000_000_000_000_000);
    }
    const usd = weiToUsdUnits(wei, reference);
    return usd === null ? presentationNumber(wei) : presentationNumber(usd, 8);
  };
  const volumeValue = (value: string) => {
    const usd = weiToUsdUnits(value, reference);
    return usd === null ? presentationNumber(BigInt(value)) : presentationNumber(usd, 8);
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

export function TokenChart({ tokenAddress, initialSupply, className = "mt-10" }: { tokenAddress: string; initialSupply?: string; className?: string }) {
  const { reference } = useOraclePrice();
  const container = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<ChartInterval>("1h");
  const [view, setView] = useState<ChartView>("price");
  const [inspectedTime, setInspectedTime] = useState<Time | null>(null);
  const query = useQuery({ queryKey: ["token-chart", tokenAddress, timeframe], queryFn: () => api.chart(tokenAddress, `?interval=${timeframe}&limit=500`), refetchInterval: 15_000 });
  const chartData = useMemo(() => query.data ? chartDisplayData(query.data.candles, view, initialSupply, reference) : { candles: [], volumes: [] }, [initialSupply, query.data, reference, view]);
  const currency = reference ? "USD" : "USDC";
  const displayedCandle = headerCandle(chartData.candles, inspectedTime);

  useEffect(() => {
    const element = container.current;
    if (!element || chartData.candles.length === 0) return;
    const formatValue = (value: number) => formatChartValue(value, currency);
    const chart = createChart(element, {
      width: element.clientWidth,
      height: element.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "#071019" }, textColor: "#7e91a0", fontFamily: "Geist, sans-serif" },
      grid: { vertLines: { color: "#10202c" }, horzLines: { color: "#10202c" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#536978", labelBackgroundColor: "#19303e" }, horzLine: { color: "#536978", labelBackgroundColor: "#19303e" } },
      rightPriceScale: { autoScale: true, borderColor: "#223443", scaleMargins: PRICE_SCALE_MARGINS },
      timeScale: { borderColor: "#223443", timeVisible: true, secondsVisible: false, rightOffset: 3, barSpacing: 8, minBarSpacing: 3 },
      localization: { priceFormatter: formatValue },
    });
    const priceSeries = chart.addSeries(CandlestickSeries, {
      upColor: CANDLE_COLORS.bullish.body,
      downColor: CANDLE_COLORS.bearish.body,
      borderVisible: false,
      wickVisible: true,
      wickUpColor: CANDLE_COLORS.bullish.wick,
      wickDownColor: CANDLE_COLORS.bearish.wick,
      priceFormat: { type: "custom", minMove: 0.000000000001, formatter: formatValue },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "right",
      priceFormat: { type: "custom", minMove: 0.00000001, formatter: formatValue },
      lastValueVisible: false,
      priceLineVisible: false,
    }, 1);
    const panes = chart.panes();
    panes[0]?.setStretchFactor(PANE_STRETCH.price);
    panes[1]?.setStretchFactor(PANE_STRETCH.volume);
    volumeSeries.priceScale().applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: 0 }, borderVisible: false });
    priceSeries.setData(chartData.candles);
    volumeSeries.setData(chartData.volumes);
    chart.timeScale().fitContent();
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
    return () => { observer.disconnect(); chart.remove(); };
  }, [chartData, currency]);

  const controls = <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-center">
    <div className="flex min-w-0 items-center gap-2">
      <label className="sr-only" htmlFor={`chart-metric-${tokenAddress}`}>Chart metric</label>
      <select id={`chart-metric-${tokenAddress}`} aria-label="Chart metric" value={view} className="min-h-11 flex-1 rounded-lg border border-white/10 bg-[#09141e] px-3 text-xs font-semibold text-zinc-200 outline-none transition focus:border-cyan-300/50 sm:min-h-9 sm:flex-none" onChange={(event) => { setInspectedTime(null); setView(event.target.value as ChartView); }}>
        <option value="price">Price</option>
        <option value="fdv" disabled={!initialSupply}>FDV</option>
      </select>
      <label className="sr-only" htmlFor={`chart-timeframe-${tokenAddress}`}>Chart timeframe</label>
      <select id={`chart-timeframe-${tokenAddress}`} aria-label="Chart timeframe" value={timeframe} className="min-h-11 flex-1 rounded-lg border border-white/10 bg-[#09141e] px-3 text-xs font-semibold text-zinc-200 outline-none transition focus:border-cyan-300/50 sm:min-h-9 sm:flex-none" onChange={(event) => { setInspectedTime(null); setTimeframe(event.target.value as ChartInterval); }}>
        {TIMEFRAMES.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </div>
    <div className="safe-scroll -mx-1 flex gap-1 px-1 sm:hidden" role="group" aria-label="Chart timeframes">
      {TIMEFRAMES.map((item) => <button key={item} type="button" aria-pressed={timeframe === item} className={`min-h-11 min-w-11 flex-none rounded-lg px-3 text-xs font-semibold ${timeframe === item ? "bg-cyan-300/12 text-cyan-200" : "text-zinc-500"}`} onClick={() => { setInspectedTime(null); setTimeframe(item); }}>{item}</button>)}
    </div>
  </div>;

  if (query.isPending) return <ChartState className={className} controls={controls} timeframe={timeframe} copy={`Loading canonical ${timeframe} candles and volume…`} loading />;
  if (query.isError) return <ChartState className={className} controls={controls} timeframe={timeframe} copy="Historical prices could not be loaded." error />;
  if (chartData.candles.length === 0) return <ChartState className={className} controls={controls} timeframe={timeframe} copy={`No complete canonical ${timeframe} candle is available yet.`} />;
  return <section className={`terminal-panel min-w-0 overflow-hidden ${className}`} aria-label="Price history">
    <div className="flex min-w-0 flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.68rem]" aria-label="Canonical candle OHLC">
          <OHLCValue label="O" value={displayedCandle ? formatChartValue(displayedCandle.open, currency) : "—"} />
          <OHLCValue label="H" value={displayedCandle ? formatChartValue(displayedCandle.high, currency) : "—"} />
          <OHLCValue label="L" value={displayedCandle ? formatChartValue(displayedCandle.low, currency) : "—"} />
          <OHLCValue label="C" value={displayedCandle ? formatChartValue(displayedCandle.close, currency) : "—"} />
          <span className={reference ? "badge-success" : "badge-warning"}>{currency}</span>
        </div>
        <p className="mt-1 text-[0.65rem] text-zinc-600">Canonical V3 {timeframe} OHLC · indexed volume · UTC</p>
      </div>
      {controls}
    </div>
    <div className="bg-[#071019]"><div ref={container} className="h-[min(16.5rem,46dvh)] w-full min-[390px]:h-[min(18.5rem,48dvh)] sm:h-[28rem] lg:h-[40rem] xl:h-[44rem]" role="img" aria-label={`${view === "price" ? "Price" : "FDV"} candlestick chart with volume in ${currency}`} /></div>
    <p className="border-t border-white/8 px-4 py-3 text-xs leading-5 text-zinc-600">{reference ? `USD reference updated ${new Date(reference.asOf).toLocaleString()}.` : "USD conversion unavailable; the chart shows 18-decimal native USDC-indexed values."} No external pool feed is used before graduation.</p>
  </section>;
}

function OHLCValue({ label, value }: { label: "O" | "H" | "L" | "C"; value: string }) {
  return <span className="whitespace-nowrap"><span className="text-zinc-600">{label}</span> <span className="text-zinc-200">{value}</span></span>;
}

function ChartState({ copy, controls, timeframe = "1h", error = false, loading = false, className }: { copy: string; controls: React.ReactNode; timeframe?: ChartInterval; error?: boolean; loading?: boolean; className: string }) {
  return <section className={`terminal-panel ${className}`} aria-label="Price history"><div className="flex min-w-0 flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold text-white">Market chart</h2><p className="mt-1 text-[0.65rem] text-zinc-600">Canonical V3 {timeframe} OHLC</p></div>{controls}</div><p className={`m-4 text-sm ${error ? "text-red-300" : "text-zinc-400"}`}>{copy}</p>{loading && <div className="skeleton m-4 h-52 rounded-xl sm:h-80" />}</section>;
}

export function formatChartValue(value: number, currency: "USD" | "USDC") {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (currency === "USD") {
    if (absolute >= 1_000_000) return `$${trimFixed(value / 1_000_000, 1)}M`;
    if (absolute >= 1_000) return `$${trimFixed(value / 1_000, 1)}K`;
    if (absolute >= 1) return `$${value.toFixed(2)}`;
    if (absolute === 0) return "$0.00";
    if (absolute < 0.000001) return `$${compactExponential(value)}`;
    return `$${trimFixed(value, 8)}`;
  }
  if (absolute === 0) return "0 USDC";
  if (absolute < 0.00000001) return `${compactExponential(value)} USDC`;
  return `${trimFixed(value, absolute >= 1 ? 4 : 8)} USDC`;
}

function trimFixed(value: number, digits: number) {
  return value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function compactExponential(value: number) {
  const [mantissa, exponent] = value.toExponential(4).split("e");
  return `${mantissa.replace(/0+$/, "").replace(/\.$/, "")}e${exponent}`;
}
