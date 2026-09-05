import { describe, expect, it } from "vitest";
import { formatCompactAmount, formatCount, formatExactTokenAmount, formatExactUSDC, formatMarketTradeUSDC, formatMarketUSDC, formatNative, formatPercentage, formatPrice, formatTokenAmount, formatTokenSymbol, formatTradeUsdc, graduationProgress } from "./format";

describe("market presentation formatting", () => {
  it("formats 18-decimal native USDC with bigint precision", () => {
    expect(formatNative(BigInt(1234567890000000000))).toBe("1.234567 USDC");
    expect(formatNative("1000000000000000000")).toBe("1 USDC");
    expect(formatNative("42")).toBe("<0.000001 USDC");
    expect(formatNative("123456789012345678901234567890")).toBe("123456789012.345678 USDC");
  });

  it("formats raw trade USDC using the indexed source", () => {
    expect(formatTradeUsdc("500000000", "uniswap_v3")).toBe("500 USDC");
    expect(formatTradeUsdc("1000000", "uniswap_v3")).toBe("1 USDC");
    expect(formatTradeUsdc("819116844", "uniswap_v3")).toBe("819.116844 USDC");
    expect(formatTradeUsdc("1000000000000000000", "curve")).toBe("1 USDC");
  });

  it("formats market aggregates at compact scale boundaries without number conversion", () => {
    expect(formatCompactAmount("999")).toBe("999");
    expect(formatCompactAmount("1000")).toBe("1K");
    expect(formatCompactAmount("1250")).toBe("1.25K");
    expect(formatCompactAmount("999999")).toBe("1M");
    expect(formatCompactAmount("1000000")).toBe("1M");
    expect(formatCompactAmount("1250000")).toBe("1.25M");
    expect(formatCompactAmount("999999999")).toBe("1B");
    expect(formatCompactAmount("1000000000")).toBe("1B");
    expect(formatCompactAmount("1000000000000")).toBe("1T");
    expect(formatCompactAmount("123456789012345678901234567890")).toBe("123,456,789,012,345,678.9T");
  });

  it("formats normalized market USDC and trade values concisely with exact values available separately", () => {
    expect(formatMarketUSDC("428969918000000000000")).toBe("$428.97");
    expect(formatMarketUSDC("1768830081000000000000")).toBe("$1.77K");
    expect(formatMarketUSDC("84496760676000000000000")).toBe("$84.5K");
    expect(formatExactUSDC("84496760676000000000000")).toBe("84,496.760676 USDC");
    expect(formatMarketTradeUSDC("1250000000000", "uniswap_v3")).toBe("$1.25M");
    expect(formatMarketUSDC("1")).not.toBe("$0");
  });

  it("formats token quantities, counts, and percentages without scientific notation", () => {
    expect(formatTokenAmount("42004773000000000000000000", 18, "MEOW")).toBe("42M $MEOW");
    expect(formatTokenAmount("160890000000000000000000000", 18, "MEOW")).toBe("160.89M $MEOW");
    expect(formatTokenAmount("800000000000000000000000000", 18, "MEOW")).toBe("800M $MEOW");
    expect(formatTokenAmount("1000000000000000000000000000", 18, "MEOW")).toBe("1B $MEOW");
    expect(formatExactTokenAmount("160890000000000000000000000", 18, "MEOW")).toBe("160,890,000 $MEOW");
    expect(formatTokenSymbol("MEOW")).toBe("$MEOW");
    expect(formatTokenSymbol("$MEOW")).toBe("$MEOW");
    expect(formatTokenSymbol("")).toBe("—");
    expect(formatTokenSymbol("$ ")).toBe("—");
    expect([3, 27, 999, 1000, 1250, 1000000].map(formatCount)).toEqual(["3", "27", "999", "1K", "1.25K", "1M"]);
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatPercentage(0)).toBe("0%");
    expect(formatPercentage(5.25)).toBe("5.25%");
    expect(formatPercentage(20.11, 1)).toBe("20.1%");
    expect(formatPercentage(100)).toBe("100%");
  });

  it("uses adaptive price precision and truthful lower bounds", () => {
    expect(formatPrice("12345678000000000000")).toBe("$12.35");
    expect(formatPrice("1234567000000000000")).toBe("$1.2346");
    expect(formatPrice("123456000000000000")).toBe("$0.12346");
    expect(formatPrice("1234560000000000")).toBe("$0.001235");
    expect(formatPrice("2620000000000")).toBe("$0.00000262");
    expect(formatPrice("1")).toBe("<$0.00000001");
    expect(formatPrice("1000000000000000000000000")).toBe("$1M");
    expect(formatPrice("not-a-number")).toBe("—");
  });

  it("keeps graduation progress bounded", () => {
    expect(graduationProgress("50", "200")).toBe(25);
    expect(graduationProgress("300", "200")).toBe(100);
  });
});
