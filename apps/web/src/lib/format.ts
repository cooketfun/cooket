import { formatEther, formatUnits } from "viem";

type Amount = string | bigint | null | undefined;
const USDC_DECIMALS = 18;
const COMPACT_SUFFIXES = ["", "K", "M", "B", "T"] as const;

// Precision-first formatter for transaction forms, quotes, balances, and receipts.
export function formatNative(value: Amount, suffix = true) {
  if (value === null || value === undefined) return "—";
  try {
    const formatted = groupDecimal(trimDecimal(formatEther(BigInt(value)), 6));
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
    const formatted = groupDecimal(trimDecimal(formatUnits(raw, source === "uniswap_v3" ? 6 : 18), 6));
    const display = formatted === "0" && raw > BigInt(0) ? "<0.000001" : formatted;
    return suffix ? `${display} USDC` : display;
  } catch { return "—"; }
}

export function formatExactUSDC(value: Amount, suffix = true) {
  const display = formatExactDecimal(value, USDC_DECIMALS, USDC_DECIMALS);
  return display === "—" ? display : suffix ? `${display} USDC` : display;
}

export function formatMarketUSDC(value: Amount, suffix = true) {
  const display = formatCompactAmount(value, USDC_DECIMALS);
  return display === "—" ? display : suffix ? `$${display}` : display;
}

export function formatMarketTradeUSDC(value: Amount, source: "curve" | "uniswap_v3", suffix = true) {
  const display = formatCompactAmount(value, source === "uniswap_v3" ? 6 : 18);
  return display === "—" ? display : suffix ? `$${display}` : display;
}

export function formatPrice(value: Amount, suffix = true) {
  if (value === null || value === undefined) return "—";
  try {
    const raw = BigInt(value), absolute = raw < BigInt(0) ? -raw : raw, unit = BigInt(10) ** BigInt(USDC_DECIMALS);
    let display: string;
    if (raw === BigInt(0)) display = "0";
    else if (absolute >= unit * BigInt(1_000)) display = formatCompactAmount(raw, USDC_DECIMALS);
    else if (absolute >= unit * BigInt(10)) display = formatRoundedDecimal(raw, USDC_DECIMALS, 2);
    else if (absolute >= unit) display = formatRoundedDecimal(raw, USDC_DECIMALS, 4);
    else if (absolute >= unit / BigInt(10)) display = formatRoundedDecimal(raw, USDC_DECIMALS, 5);
    else if (absolute >= unit / BigInt(1_000)) display = formatRoundedDecimal(raw, USDC_DECIMALS, 6);
    else if (absolute >= unit / BigInt(100_000_000)) display = formatRoundedDecimal(raw, USDC_DECIMALS, 8);
    else display = raw > BigInt(0) ? "<0.00000001" : ">-0.00000001";
    if (!suffix) return display;
    return display.startsWith("<") ? `<$${display.slice(1)}` : display.startsWith(">") ? `>$${display.slice(1)}` : `$${display}`;
  } catch { return "—"; }
}

export function formatCompactAmount(value: Amount, decimals = 0) {
  if (value === null || value === undefined || !Number.isInteger(decimals) || decimals < 0) return "—";
  try {
    const raw = BigInt(value), negative = raw < BigInt(0), absolute = negative ? -raw : raw, unit = BigInt(10) ** BigInt(decimals);
    let scale = 0;
    while (scale < COMPACT_SUFFIXES.length - 1 && absolute >= unit * (BigInt(1_000) ** BigInt(scale + 1))) scale += 1;
    while (true) {
      const denominator = unit * (BigInt(1_000) ** BigInt(scale));
      const rounded = (absolute * BigInt(100) + denominator / BigInt(2)) / denominator;
      if (rounded === BigInt(0) && absolute > BigInt(0)) return `${negative ? ">-" : "<"}0.01${COMPACT_SUFFIXES[scale]}`;
      if (rounded >= BigInt(100_000) && scale < COMPACT_SUFFIXES.length - 1) { scale += 1; continue; }
      const whole = rounded / BigInt(100);
      const fraction = (rounded % BigInt(100)).toString().padStart(2, "0").replace(/0+$/, "");
      return `${negative ? "-" : ""}${groupInteger(whole.toString())}${fraction ? `.${fraction}` : ""}${COMPACT_SUFFIXES[scale]}`;
    }
  } catch { return "—"; }
}

export function formatTokenAmount(value: string | bigint | null | undefined, decimals = 18, symbol?: string) {
  const display = formatCompactAmount(value, decimals);
  const formattedSymbol = symbol ? formatTokenSymbol(symbol) : undefined;
  return display === "—" ? display : formattedSymbol && formattedSymbol !== "—" ? `${display} ${formattedSymbol}` : display;
}

export function formatExactTokenAmount(value: Amount, decimals = 18, symbol?: string) {
  const display = formatExactDecimal(value, decimals, decimals);
  const formattedSymbol = symbol ? formatTokenSymbol(symbol) : undefined;
  return display === "—" ? display : formattedSymbol && formattedSymbol !== "—" ? `${display} ${formattedSymbol}` : display;
}

export function formatTokenSymbol(symbol: string | null | undefined) {
  const normalized = symbol?.trim().replace(/^\$+/, "");
  return normalized && /^[A-Za-z0-9._-]+$/.test(normalized) ? `$${normalized}` : "—";
}

export function formatCount(value: string | bigint | number | null | undefined) {
  if (value === null || value === undefined || (typeof value === "number" && (!Number.isFinite(value) || !Number.isInteger(value)))) return "—";
  return formatCompactAmount(typeof value === "number" ? BigInt(value) : value, 0);
}

export function formatPercentage(value: number | null | undefined, maxDigits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.min(100, Math.max(0, value)).toFixed(maxDigits).replace(/0+$/, "").replace(/\.$/, "")}%`;
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

export function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1_000) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return formatCompactAmount(BigInt(Math.round(value * 100)), 2);
}

function formatExactDecimal(value: Amount, decimals: number, digits: number) {
  if (value === null || value === undefined) return "—";
  try { return groupDecimal(trimDecimal(formatUnits(BigInt(value), decimals), digits)); }
  catch { return "—"; }
}

function formatRoundedDecimal(value: bigint, decimals: number, digits: number) {
  const negative = value < BigInt(0), absolute = negative ? -value : value;
  const unit = BigInt(10) ** BigInt(decimals), precision = BigInt(10) ** BigInt(digits);
  const rounded = (absolute * precision + unit / BigInt(2)) / unit;
  const whole = rounded / precision;
  const fraction = (rounded % precision).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${groupInteger(whole.toString())}${fraction ? `.${fraction}` : ""}`;
}

function trimDecimal(value: string, digits: number) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, digits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function groupDecimal(value: string) {
  const [whole, fraction] = value.split(".");
  return `${groupInteger(whole)}${fraction ? `.${fraction}` : ""}`;
}

function groupInteger(value: string) {
  const sign = value.startsWith("-") ? "-" : "";
  const digits = sign ? value.slice(1) : value;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
