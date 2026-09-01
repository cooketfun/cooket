import { describe, expect, it } from "vitest";
import { BUY_MAX_GAS_RESERVE_WEI, buyPresetWei, formatPresetInput, isPresetEnabled, percentOfBalance, sellPresetAmount } from "./trade-amount-presets";

const eth = BigInt("1000000000000000000");

describe("trade amount presets", () => {
  it("computes 10% and 50% with bigint integer math", () => {
    expect(percentOfBalance(eth, 10)).toBe(BigInt("100000000000000000"));
    expect(percentOfBalance(eth, 50)).toBe(BigInt("500000000000000000"));
    expect(buyPresetWei(eth, "10")).toBe(BigInt("100000000000000000"));
    expect(buyPresetWei(eth, "50")).toBe(BigInt("500000000000000000"));
    expect(sellPresetAmount(eth * BigInt(5), "10")).toBe(eth / BigInt(2));
    expect(sellPresetAmount(eth * BigInt(5), "50")).toBe(eth * BigInt(5) / BigInt(2));
  });

  it("uses the exact token balance for sell MAX", () => {
    const balance = BigInt("1234567890123456789");
    expect(sellPresetAmount(balance, "max")).toBe(balance);
    expect(formatPresetInput(balance, 18)).toBe("1.234567890123456789");
  });

  it("reserves ETH for gas on buy MAX and never goes negative", () => {
    expect(buyPresetWei(eth, "max")).toBe(eth - BUY_MAX_GAS_RESERVE_WEI);
    expect(buyPresetWei(BUY_MAX_GAS_RESERVE_WEI, "max")).toBe(BigInt(0));
    expect(buyPresetWei(BUY_MAX_GAS_RESERVE_WEI - BigInt(1), "max")).toBe(BigInt(0));
    expect(isPresetEnabled(buyPresetWei(BUY_MAX_GAS_RESERVE_WEI, "max"))).toBe(false);
  });

  it("disables presets when balances are unavailable or zero", () => {
    expect(buyPresetWei(undefined, "10")).toBeNull();
    expect(sellPresetAmount(undefined, "max")).toBeNull();
    expect(isPresetEnabled(buyPresetWei(undefined, "10"))).toBe(false);
    expect(isPresetEnabled(sellPresetAmount(BigInt(0), "max"))).toBe(false);
    expect(formatPresetInput(BigInt(0), 18)).toBe("");
  });

  it("formats non-18 decimal token amounts without floating-point math", () => {
    expect(formatPresetInput(BigInt("1234567"), 6)).toBe("1.234567");
    expect(sellPresetAmount(BigInt("1000000"), "max")).toBe(BigInt("1000000"));
  });
});
