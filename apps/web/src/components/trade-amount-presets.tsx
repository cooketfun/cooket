"use client";

import { buyPresetWei, formatPresetInput, isPresetEnabled, sellPresetAmount, type AmountPreset } from "@/lib/trade-amount-presets";

type Props = {
  side: "buy" | "sell";
  nativeBalance?: bigint;
  buyBalance?: bigint;
  buyDecimals?: number;
  buyIsNative?: boolean;
  tokenBalance?: bigint;
  tokenDecimals?: number;
  disabled?: boolean;
  onSelect: (value: string) => void;
};

const presets: { id: AmountPreset; label: string }[] = [
  { id: "10", label: "10%" },
  { id: "50", label: "50%" },
  { id: "max", label: "MAX" },
];

export function TradeAmountPresets({ side, nativeBalance, buyBalance, buyDecimals = 18, buyIsNative = true, tokenBalance, tokenDecimals = 18, disabled = false, onSelect }: Props) {
  const availableBuyBalance = buyBalance ?? nativeBalance;
  const amountFor = (preset: AmountPreset) => side === "buy" ? (buyIsNative ? buyPresetWei(availableBuyBalance, preset) : sellPresetAmount(availableBuyBalance, preset)) : sellPresetAmount(tokenBalance, preset);
  const apply = (preset: AmountPreset) => {
    const amount = amountFor(preset);
    if (amount === null || !isPresetEnabled(amount)) return;
    onSelect(formatPresetInput(amount, side === "buy" ? buyDecimals : tokenDecimals));
  };

  return <div className="mt-2 flex gap-2" role="group" aria-label="Amount presets">
    {presets.map((preset) => {
      const enabled = !disabled && isPresetEnabled(amountFor(preset.id));
      return <button
        key={preset.id}
        type="button"
        aria-label={presetLabel(side, preset.id, buyIsNative)}
        disabled={!enabled}
        onClick={() => apply(preset.id)}
        className="button-secondary min-h-11 flex-1 px-2 text-xs font-semibold tracking-wide"
      >{preset.label}</button>;
    })}
  </div>;
}

function presetLabel(side: "buy" | "sell", preset: AmountPreset, buyIsNative: boolean) {
  if (side === "buy") {
    if (!buyIsNative) return preset === "max" ? "Use exact USDC balance" : `Use ${preset}% of USDC balance`;
    if (preset === "max") return "Use maximum native USDC after gas reserve";
    return `Use ${preset}% of native USDC balance`;
  }
  if (preset === "max") return "Use exact token balance";
  return `Use ${preset}% of token balance`;
}
