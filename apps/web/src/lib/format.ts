import { formatEther, formatUnits } from "viem";

const USD_SCALE = BigInt(100_000_000);
const WEI_PER_ETH = BigInt(1_000_000_000_000_000_000);

export type EthUsdReference = Readonly<{
  scaledUsdPerEth: bigint;
  asOf: string;
}>;

export function parseEthUsdReference(price?: string, asOf?: string): EthUsdReference | null {
  if (!price || !asOf || !/^\d+(\.\d{1,8})?$/.test(price)) return null;
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) return null;
  const [whole, fraction = ""] = price.split(".");
  const scaledUsdPerEth = BigInt(whole) * USD_SCALE + BigInt(fraction.padEnd(8, "0"));
  if (scaledUsdPerEth <= BigInt(0)) return null;
  return { scaledUsdPerEth, asOf: new Date(timestamp).toISOString() };
}

export function weiToUsdUnits(value: string | bigint, reference: EthUsdReference | null) {
  if (!reference) return null;
  try { return BigInt(value) * reference.scaledUsdPerEth / WEI_PER_ETH; }
  catch { return null; }
}

export function formatWeiUsd(value: string | bigint | null | undefined, reference: EthUsdReference | null) {
  if (value === null || value === undefined) return "—";
  if (!reference) return "USD unavailable";
  const units = weiToUsdUnits(value, reference);
  return units === null ? "—" : formatUsdUnits(units);
}

export function formatUsdUnits(units: bigint) {
  const negative = units < BigInt(0);
  const absolute = negative ? -units : units;
  const sign = negative ? "−" : "";
  const compact = (divisor: bigint, suffix: string) => {
    const tenths = absolute * BigInt(10) / divisor;
    const whole = tenths / BigInt(10);
    const decimal = tenths % BigInt(10);
    return `${sign}$${whole.toString()}${decimal ? `.${decimal.toString()}` : ""}${suffix}`;
  };
  if (absolute >= USD_SCALE * BigInt(1_000_000_000)) return compact(USD_SCALE * BigInt(1_000_000_000), "B");
  if (absolute >= USD_SCALE * BigInt(1_000_000)) return compact(USD_SCALE * BigInt(1_000_000), "M");
  if (absolute >= USD_SCALE * BigInt(1_000)) return compact(USD_SCALE * BigInt(1_000), "K");
  const whole = absolute / USD_SCALE;
  const fraction = (absolute % USD_SCALE).toString().padStart(8, "0");
  if (whole > BigInt(0)) return `${sign}$${whole.toLocaleString("en-US")}.${fraction.slice(0, 2)}`;
  if (absolute === BigInt(0)) return "$0.00";
  const decimals = absolute >= BigInt(1_000_000) ? 4 : 8;
  return `${sign}$0.${fraction.slice(0, decimals).replace(/0+$/, "") || "0"}`;
}

export function formatNative(value: string | bigint | null | undefined, suffix = true) {
  if (value === null || value === undefined) return "—";
  try {
    const formatted = trimDecimal(formatEther(BigInt(value)), 6);
    const display = formatted === "0" && BigInt(value) > BigInt(0) ? "<0.000001" : formatted;
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
