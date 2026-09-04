import { formatEther, formatUnits } from "viem";

export function formatNative(value: string | bigint | null | undefined, suffix = true) {
  if (value === null || value === undefined) return "—";
  try {
    const formatted = trimDecimal(formatEther(BigInt(value)), 6);
    const display = formatted === "0" && BigInt(value) > BigInt(0) ? "<0.000001" : formatted;
    return suffix ? `${display} USDC` : display;
  } catch { return "—"; }
}

// Trade rows retain raw on-chain amounts. Curve accounting is native
// 18-decimal USDC, while canonical V3 swaps settle in 6-decimal ERC-20 USDC.
export function formatTradeUsdc(value: string | bigint | null | undefined, source: "curve" | "uniswap_v3", suffix = true) {
  if (value === null || value === undefined) return "—";
  try {
    const raw = BigInt(value);
    const formatted = trimDecimal(formatUnits(raw, source === "uniswap_v3" ? 6 : 18), 6);
    const display = formatted === "0" && raw > BigInt(0) ? "<0.000001" : formatted;
    return suffix ? `${display} USDC` : display;
  } catch { return "—"; }
}

export function formatTokenAmount(value: string | bigint | null | undefined, decimals = 18, symbol?: string) {
  if (value === null || value === undefined) return "—";
  try {
    const display = compactDecimal(formatUnits(BigInt(value), decimals));
    return symbol ? `${display} ${symbol}` : display;
  } catch { return "—"; }
}

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { notation: value >= 1_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export function graduationProgress(sold?: string, threshold?: string) {
  if (!sold || !threshold) return null;
  try {
    const denominator = BigInt(threshold);
    if (denominator <= BigInt(0)) return null;
    const bps = BigInt(sold) * BigInt(10_000) / denominator;
    return Number(bps > BigInt(10_000) ? BigInt(10_000) : bps) / 100;
  } catch { return null; }
}

export function presentationNumber(value: bigint, decimals = 18) {
  const text = formatUnits(value, decimals);
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function compactDecimal(value: string) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && Math.abs(numeric) >= 1_000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(numeric);
  return trimDecimal(value, 6);
}

function trimDecimal(value: string, digits: number) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, digits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
