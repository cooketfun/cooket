"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartInterval, ChartPoint, Token, Trade } from "@cooket/types";
import { selectedCooketChainId } from "@/lib/chain";

export type RealtimeTrade = { identity: string; chain_id: number; token: string; market: string; source: "curve" | "uniswap_v3"; side: "buy" | "sell"; block_number: number; block_timestamp?: number; transaction_hash: string; log_index: number; removed: boolean; received_at: string; token_amount_raw: string; usdc_amount_raw: string; usdc_decimals: 6 | 18; raw_fields?: Record<string, string> };
export type RealtimeSurface = "token" | "chart" | "trades";
export type RealtimeSurfaceWatermarks = Partial<Record<RealtimeSurface, number>>;
const DEDUPE_CAPACITY = 256;
const COOKET_TOKEN_DECIMALS = 18;
const integer = (value: unknown): value is string => typeof value === "string" && /^\d+$/.test(value);
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const canonicalTradeIdentity = (trade: Pick<Trade, "transaction_hash" | "log_index">) => `${selectedCooketChainId}:${trade.transaction_hash}:${trade.log_index}`;

// A page can safely forget an event only when every independently-polled
// canonical surface has committed through the event's entire block.
export function safeRealtimeRetirementFloor({ token, chart, trades }: RealtimeSurfaceWatermarks): number | undefined {
  return token === undefined || chart === undefined || trades === undefined ? undefined : Math.min(token, chart, trades);
}

export function advanceRealtimeSurfaceWatermark(current: RealtimeSurfaceWatermarks, surface: RealtimeSurface, block: number | undefined): RealtimeSurfaceWatermarks {
  // A timeframe switch starts a new chart-snapshot generation. It is not safe
  // to use the prior interval's data until the new interval returns a snapshot.
  if (block === undefined) return surface === "chart" && current.chart !== undefined ? { ...current, chart: undefined } : current;
  const prior = current[surface];
  return prior === undefined || block > prior ? { ...current, [surface]: block } : current;
}

export function parseRealtimeTrade(value: unknown, tokenAddress: string): RealtimeTrade | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.chain_id !== selectedCooketChainId || typeof event.token !== "string" || !sameAddress(event.token, tokenAddress) || typeof event.identity !== "string" || typeof event.transaction_hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(event.transaction_hash)) return null;
  if (typeof event.block_number !== "number" || !Number.isSafeInteger(event.block_number) || typeof event.log_index !== "number" || !Number.isSafeInteger(event.log_index) || event.identity !== `${event.chain_id}:${event.transaction_hash}:${event.log_index}` || typeof event.market !== "string" || event.source !== "curve" && event.source !== "uniswap_v3" || event.side !== "buy" && event.side !== "sell" || typeof event.removed !== "boolean" || !integer(event.token_amount_raw) || !integer(event.usdc_amount_raw) || (event.usdc_decimals !== 6 && event.usdc_decimals !== 18)) return null;
  const timestamp = event.block_timestamp;
  if (!event.removed && (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0)) return null;
  if (event.removed && timestamp !== undefined && (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0)) return null;
  return { identity: event.identity, chain_id: event.chain_id as number, token: event.token, market: event.market, source: event.source, side: event.side, block_number: event.block_number, block_timestamp: timestamp as number | undefined, transaction_hash: event.transaction_hash, log_index: event.log_index, removed: event.removed, received_at: typeof event.received_at === "string" ? event.received_at : "", token_amount_raw: event.token_amount_raw, usdc_amount_raw: event.usdc_amount_raw, usdc_decimals: event.usdc_decimals, raw_fields: event.raw_fields && typeof event.raw_fields === "object" ? event.raw_fields as Record<string, string> : undefined };
}

export function useTokenRealtimeTrades(tokenAddress: string, retireThroughBlock: number | undefined, realtimeURL = process.env.NEXT_PUBLIC_REALTIME_URL): RealtimeTrade[] {
  const [events, setEvents] = useState<RealtimeTrade[]>([]);
  // This is the page-wide *safe floor*: an identity is retired only after every
  // canonical surface has observed a snapshot through its whole block.
  const watermark = useRef<number | undefined>(retireThroughBlock);
  useEffect(() => {
    if (retireThroughBlock === undefined) return;
    watermark.current = watermark.current === undefined ? retireThroughBlock : Math.max(watermark.current, retireThroughBlock);
    setEvents((current) => current.filter((event) => event.block_number > watermark.current!));
  }, [retireThroughBlock]);
  useEffect(() => {
    if (!tokenAddress || !realtimeURL || typeof EventSource === "undefined") return;
    let source: EventSource;
    try { source = new EventSource(`${realtimeURL.replace(/\/$/, "")}/events`); } catch { return; }
    const receive = (message: MessageEvent<string>) => {
      let data: unknown; try { data = JSON.parse(message.data); } catch { return; }
      const event = parseRealtimeTrade(data, tokenAddress); if (!event) return;
      setEvents((current) => {
        const exists = current.some((item) => item.identity === event.identity);
        if (event.removed) return exists ? current.filter((item) => item.identity !== event.identity) : current;
        if (watermark.current !== undefined && event.block_number <= watermark.current) return current;
        return exists ? current : [...current, event].slice(-DEDUPE_CAPACITY);
      });
    };
    source.addEventListener("trade", receive as EventListener);
    return () => { source.removeEventListener("trade", receive as EventListener); source.close(); };
  }, [realtimeURL, tokenAddress]);
  return events;
}

export function reconcileRealtimeTrades(events: readonly RealtimeTrade[], indexedThroughBlock: number | undefined, canonical?: readonly Trade[]) {
	const canonicalIDs = new Set((canonical ?? []).map(canonicalTradeIdentity));
	return events.filter((event) => (indexedThroughBlock === undefined || event.block_number > indexedThroughBlock) && !canonicalIDs.has(event.identity)).sort(chainOrder);
}
export function chainOrder(a: RealtimeTrade, b: RealtimeTrade) { return (a.block_timestamp ?? -1) - (b.block_timestamp ?? -1) || a.block_number - b.block_number || a.log_index - b.log_index || a.identity.localeCompare(b.identity); }
export function realtimePrice(event: RealtimeTrade, tokenDecimals = COOKET_TOKEN_DECIMALS): bigint | null { try { const tokens = BigInt(event.token_amount_raw); return tokens === BigInt(0) ? null : BigInt(event.usdc_amount_raw) * BigInt(10) ** BigInt(tokenDecimals + 18 - event.usdc_decimals) / tokens; } catch { return null; } }
export function realtimeVolume(event: RealtimeTrade): bigint { return BigInt(event.usdc_amount_raw) * BigInt(10) ** BigInt(18 - event.usdc_decimals); }
export function curveActor(event: RealtimeTrade) { const value = event.source === "curve" ? event.side === "buy" ? event.raw_fields?.buyer : event.raw_fields?.seller : undefined; return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : undefined; }

export function overlayMetrics(token: Token, events: readonly RealtimeTrade[]) {
  const sorted = [...events].sort(chainOrder); const latest = sorted.at(-1); const price = latest ? realtimePrice(latest) : null;
  return { ...token.metrics, current_price: price?.toString() ?? token.metrics.current_price, fully_diluted_value: price === null ? token.metrics.fully_diluted_value : (price * BigInt(token.initial_supply) / BigInt(10) ** BigInt(COOKET_TOKEN_DECIMALS)).toString(), volume: (BigInt(token.metrics.volume) + sorted.reduce((total, event) => total + realtimeVolume(event), BigInt(0))).toString(), trade_count: token.metrics.trade_count + sorted.length };
}

const seconds: Record<ChartInterval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
export function overlayCandles(canonical: readonly ChartPoint[], events: readonly RealtimeTrade[], interval: ChartInterval) {
  const buckets = new Map(canonical.map((candle) => [candle.bucket_start, { ...candle }]));
  for (const event of [...events].sort(chainOrder)) {
    if (event.block_timestamp === undefined) continue;
    const price = realtimePrice(event); if (price === null) continue;
    const bucket = Math.floor(event.block_timestamp / seconds[interval]) * seconds[interval]; const current = buckets.get(bucket); const priceText = price.toString(); const volume = realtimeVolume(event);
    if (!current) { buckets.set(bucket, { bucket_start: bucket, trade_count: 1, buy_count: event.side === "buy" ? 1 : 0, sell_count: event.side === "sell" ? 1 : 0, volume: volume.toString(), unique_trader_count: 0, open_price: priceText, high_price: priceText, low_price: priceText, close_price: priceText }); continue; }
    buckets.set(bucket, { ...current, trade_count: current.trade_count + 1, buy_count: current.buy_count + (event.side === "buy" ? 1 : 0), sell_count: current.sell_count + (event.side === "sell" ? 1 : 0), volume: (BigInt(current.volume) + volume).toString(), open_price: current.open_price ?? priceText, high_price: !current.high_price || BigInt(current.high_price) < price ? priceText : current.high_price, low_price: !current.low_price || BigInt(current.low_price) > price ? priceText : current.low_price, close_price: priceText });
  }
  return [...buckets.values()].sort((a, b) => a.bucket_start - b.bucket_start);
}
