"use client";

import type { RealtimeTrade } from "@/lib/token-realtime";
import { TokenChart } from "@/components/token-chart";

// Deliberate Phase 5 boundary: swap this fallback for an official-library
// lifecycle only after licensed TradingView Advanced Charts assets are present.
export function TokenAdvancedChart(props: { tokenAddress: string; symbol?: string; initialSupply?: string; realtimeEvents?: readonly RealtimeTrade[]; onIndexedThroughBlock?: (block: number | undefined) => void; className?: string }) {
  return <TokenChart {...props} />;
}
