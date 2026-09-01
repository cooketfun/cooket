import { formatEther, formatUnits } from "viem";

/** Phase 0 display helper: reserve 0.001 native USDC (18-decimal units) for gas. */
export const BUY_MAX_GAS_RESERVE_WEI = BigInt("1000000000000000");

export type AmountPreset = "10" | "50" | "max";

export function percentOfBalance(balance: bigint, percent: 10 | 50): bigint {
  if (balance <= BigInt(0)) return BigInt(0);
  return (balance * BigInt(percent)) / BigInt(100);
}

export function buyPresetWei(nativeBalance: bigint | undefined, preset: AmountPreset): bigint | null {
  if (nativeBalance === undefined) return null;
  if (preset === "max") {
    return nativeBalance > BUY_MAX_GAS_RESERVE_WEI ? nativeBalance - BUY_MAX_GAS_RESERVE_WEI : BigInt(0);
  }
  return percentOfBalance(nativeBalance, preset === "10" ? 10 : 50);
}

export function sellPresetAmount(tokenBalance: bigint | undefined, preset: AmountPreset): bigint | null {
  if (tokenBalance === undefined) return null;
  if (preset === "max") return tokenBalance;
  return percentOfBalance(tokenBalance, preset === "10" ? 10 : 50);
}

export function formatPresetInput(amount: bigint, decimals: number): string {
  if (amount <= BigInt(0)) return "";
  const raw = decimals === 18 ? formatEther(amount) : formatUnits(amount, decimals);
  return raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
}

export function isPresetEnabled(amount: bigint | null): boolean {
  return amount !== null && amount > BigInt(0);
}
