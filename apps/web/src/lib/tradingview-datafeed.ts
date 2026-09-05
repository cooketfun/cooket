import type { ChartInterval, ChartPage, ChartPoint, Token } from "@cooket/types";
import { overlayCandles, reconcileRealtimeTrades, type RealtimeTrade } from "@/lib/token-realtime";

// These are structural Datafeed API types, deliberately kept independent from
// the proprietary Charting Library package.  They make the Cooket adapter
// testable and ready to hand to TradingView once licensed assets are supplied.
export type TradingViewResolution = "1" | "5" | "15" | "60" | "240" | "D" | "W";
export type TradingViewBar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type TradingViewSymbol = {
  name: string; ticker: string; full_name: string; description: string; type: "crypto";
  session: "24x7"; timezone: "Etc/UTC"; exchange: "Cooket"; listed_exchange: "Cooket";
  currency_code: "USDC"; pricescale: number; volume_precision: number;
  has_intraday: true; has_daily: true; has_weekly_and_monthly: true;
  supported_resolutions: readonly TradingViewResolution[];
  token_address: string;
};
export type HistoryMetadata = { noData: boolean; nextTime?: number };
export type BarSubscription = (bar: TradingViewBar) => void;
export type ChartFetcher = (address: string, query: string) => Promise<ChartPage>;

export const TRADINGVIEW_RESOLUTION_INTERVAL: Readonly<Record<TradingViewResolution, ChartInterval>> = {
  "1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", D: "1d", W: "1w",
};
export const TRADINGVIEW_RESOLUTIONS = Object.keys(TRADINGVIEW_RESOLUTION_INTERVAL) as TradingViewResolution[];

export function cooketIntervalForResolution(resolution: string): ChartInterval | null {
  return Object.prototype.hasOwnProperty.call(TRADINGVIEW_RESOLUTION_INTERVAL, resolution)
    ? TRADINGVIEW_RESOLUTION_INTERVAL[resolution as TradingViewResolution] : null;
}

// TradingView requires JS numbers. Convert at this sole boundary from the
// canonical 18-decimal integer, never through Number(raw). This retains the
// decimal magnitude before IEEE-754's unavoidable display-number rounding.
export function nativeUsdc18ToDisplayNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const whole = value.length > 18 ? value.slice(0, -18) : "0";
  const fraction = value.length > 18 ? value.slice(-18) : value.padStart(18, "0");
  const decimal = `${whole}.${fraction}`;
  const number = Number(decimal);
  return Number.isFinite(number) ? number : null;
}

function complete(point: ChartPoint): point is ChartPoint & { open_price: string; high_price: string; low_price: string; close_price: string } {
  return [point.open_price, point.high_price, point.low_price, point.close_price].every((value) => typeof value === "string" && /^\d+$/.test(value));
}

export function candleToTradingViewBar(point: ChartPoint): TradingViewBar | null {
  if (!complete(point)) return null;
  const [open, high, low, close, volume] = [point.open_price, point.high_price, point.low_price, point.close_price, point.volume].map(nativeUsdc18ToDisplayNumber);
  return open === null || high === null || low === null || close === null || volume === null ? null : { time: point.bucket_start * 1_000, open, high, low, close, volume };
}

// Storage is always 18-decimal native USDC. Chart display increments are a
// separate, safe metadata choice: retain six meaningful digits after leading
// fractional zeroes, capped at 12 decimal places (1e12 is a safe integer).
export function tradingViewDisplayPrecision(price: string | null | undefined): number {
  if (!price || !/^\d+$/.test(price)) return 10;
  const decimal = price.padStart(19, "0").slice(-18);
  const leadingZeroes = decimal.match(/^0*/)?.[0].length ?? 0;
  return Math.min(12, Math.max(8, leadingZeroes + 6));
}
export function tradingViewPriceScale(price: string | null | undefined): number { return 10 ** tradingViewDisplayPrecision(price); }

export function cooketSymbol(token: Pick<Token, "address" | "name" | "symbol"> & Partial<Pick<Token, "metrics">>): TradingViewSymbol {
  const base = token.symbol.trim().replace(/^\$+/, "").toUpperCase() || "TOKEN";
  const pair = `${base} / USDC`;
  return { name: pair, ticker: pair, full_name: pair, description: token.name, type: "crypto", session: "24x7", timezone: "Etc/UTC", exchange: "Cooket", listed_exchange: "Cooket", currency_code: "USDC", pricescale: tradingViewPriceScale(token.metrics?.current_price), volume_precision: 18, has_intraday: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: TRADINGVIEW_RESOLUTIONS, token_address: token.address };
}

type Subscription = { resolution: TradingViewResolution; callback: BarSubscription; reset?: () => void; canonical: ChartPoint[]; indexedThroughBlock?: number; lastEmittedTime?: number };

export class CooketTradingViewDatafeed {
  private readonly symbol: TradingViewSymbol;
  private readonly subscriptions = new Map<string, Subscription>();
  private realtime: readonly RealtimeTrade[] = [];

  constructor(private readonly token: Pick<Token, "address" | "name" | "symbol"> & Partial<Pick<Token, "metrics">>, private readonly chart: ChartFetcher) {
    this.symbol = cooketSymbol(token);
  }

  onReady(callback: (configuration: { supported_resolutions: readonly TradingViewResolution[]; supports_search: false; supports_group_request: false; supports_marks: false; supports_timescale_marks: false }) => void) {
    queueMicrotask(() => callback({ supported_resolutions: TRADINGVIEW_RESOLUTIONS, supports_search: false, supports_group_request: false, supports_marks: false, supports_timescale_marks: false }));
  }

  resolveSymbol(_symbolName: string, onResolve: (symbol: TradingViewSymbol) => void, _onError: (reason: string) => void) { queueMicrotask(() => onResolve(this.symbol)); }

  async getBars(_symbol: TradingViewSymbol, resolution: string, period: { from: number; to: number; countBack?: number; firstDataRequest?: boolean }, onHistory: (bars: TradingViewBar[], metadata: HistoryMetadata) => void, onError: (reason: string) => void) {
    const interval = cooketIntervalForResolution(resolution);
    if (!interval) { onError(`Unsupported Cooket resolution: ${resolution}`); return; }
    try {
      const limit = Math.min(1_000, Math.max(1, period.countBack ?? 1_000));
      // countBack asks for N bars ending at `to`; otherwise the exact [from,to)
      // range is fetched. The API applies bounds before its bounded limit, so
      // old history never disappears behind the latest 1,000 candles.
      const range = period.countBack ? `to=${period.to}&limit=${limit}` : `from=${period.from}&to=${period.to}&limit=${limit}`;
      const page = await this.chart(this.token.address, `?interval=${interval}&${range}`);
      const bars = page.candles.map(candleToTradingViewBar).filter((bar): bar is TradingViewBar => bar !== null);
      onHistory(bars, { noData: bars.length === 0 });
    } catch (error) { onError(error instanceof Error ? error.message : "Cooket chart history could not be loaded."); }
  }

  subscribeBars(_symbol: TradingViewSymbol, resolution: string, callback: BarSubscription, listenerGuid: string, reset?: () => void) {
    const interval = cooketIntervalForResolution(resolution);
    if (!interval) return;
    this.subscriptions.set(listenerGuid, { resolution: resolution as TradingViewResolution, callback, reset, canonical: [] });
  }

  unsubscribeBars(listenerGuid: string) { this.subscriptions.delete(listenerGuid); }

  // Called by the existing Phase 4 React owner. It opens no EventSource and
  // performs no RPC: native browser reconnect and the page-wide retirement
  // floor remain the single source of realtime lifecycle truth.
  syncRealtime(events: readonly RealtimeTrade[]) {
    const active = new Map<string, RealtimeTrade>();
    for (const event of events) {
      if (event.token.toLowerCase() !== this.token.address.toLowerCase()) continue;
      if (event.removed) active.delete(event.identity);
      else active.set(event.identity, event);
    }
    this.realtime = [...active.values()];
    this.emitProvisionalBars();
  }

  // Feed each subscriber's authoritative chart snapshot into the same overlay
  // primitive used by lightweight-charts. Acknowledged blocks are excluded,
  // so a canonical refresh replaces rather than duplicates a provisional bar.
  reconcileCanonical(listenerGuid: string, page: ChartPage) {
    const subscription = this.subscriptions.get(listenerGuid);
    if (!subscription) return;
    subscription.canonical = page.candles;
    subscription.indexedThroughBlock = page.indexed_through_block;
    this.emitSubscription(subscription);
  }

  private emitProvisionalBars() { for (const subscription of this.subscriptions.values()) this.emitSubscription(subscription); }
  private emitSubscription(subscription: Subscription) {
    const interval = TRADINGVIEW_RESOLUTION_INTERVAL[subscription.resolution];
    const provisional = reconcileRealtimeTrades(this.realtime, subscription.indexedThroughBlock);
    const bar = overlayCandles(subscription.canonical, provisional, interval).map(candleToTradingViewBar).filter((item): item is TradingViewBar => item !== null).at(-1);
    // A cache has seen a newer bar vanish. TradingView callbacks must never
    // move time backwards; request a rebuild instead of sending a fake older
    // bar. Same-bucket removals remain normal corrected-bar updates.
    if (!bar || (subscription.lastEmittedTime !== undefined && bar.time < subscription.lastEmittedTime)) {
      if (subscription.lastEmittedTime !== undefined) { subscription.lastEmittedTime = undefined; subscription.reset?.(); }
      return;
    }
    subscription.lastEmittedTime = bar.time;
    subscription.callback(bar);
  }
}
