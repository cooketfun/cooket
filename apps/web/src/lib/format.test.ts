import { describe, expect, it } from "vitest";
import { formatNative, formatTradeUsdc, graduationProgress } from "./format";

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

  it("keeps graduation progress bounded", () => {
    expect(graduationProgress("50", "200")).toBe(25);
    expect(graduationProgress("300", "200")).toBe(100);
  });
});
