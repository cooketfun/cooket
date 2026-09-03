import { describe, expect, it } from "vitest";
import { formatNative, graduationProgress } from "./format";

describe("market presentation formatting", () => {
  it("formats 18-decimal native USDC with bigint precision", () => {
    expect(formatNative(BigInt(1234567890000000000))).toBe("1.234567 USDC");
    expect(formatNative("1000000000000000000")).toBe("1 USDC");
    expect(formatNative("42")).toBe("<0.000001 USDC");
    expect(formatNative("123456789012345678901234567890")).toBe("123456789012.345678 USDC");
  });

  it("keeps graduation progress bounded", () => {
    expect(graduationProgress("50", "200")).toBe(25);
    expect(graduationProgress("300", "200")).toBe(100);
  });
});
