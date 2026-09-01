import { describe, expect, it } from "vitest";
import { formatNative, formatUsdUnits, formatWeiUsd, graduationProgress, parseEthUsdReference } from "./format";

describe("market presentation formatting", () => {
  it("requires both a valid ETH/USD price and timestamp", () => {
    expect(parseEthUsdReference("2500.25", "2026-08-15T00:00:00Z")).toEqual({ scaledUsdPerEth: BigInt(250025000000), asOf: "2026-08-15T00:00:00.000Z" });
    expect(parseEthUsdReference("2500", undefined)).toBeNull();
    expect(parseEthUsdReference("not-a-price", "2026-08-15T00:00:00Z")).toBeNull();
  });

  it("converts wei with integer arithmetic and never fabricates unavailable USD", () => {
    const reference = parseEthUsdReference("2500", "2026-08-15T00:00:00Z");
    expect(formatWeiUsd("1000000000000000000", reference)).toBe("$2.5K");
    expect(formatWeiUsd("1000000000", reference)).toBe("$0.0000025");
    expect(formatWeiUsd("1000000000000000000", null)).toBe("USD unavailable");
  });

  it("uses compact USD, readable native USDC, and bounded graduation progress", () => {
    expect(formatUsdUnits(BigInt(480000000000))).toBe("$4.8K");
    expect(formatNative(BigInt(1234567890000000000))).toBe("1.234567 USDC");
    expect(graduationProgress("50", "200")).toBe(25);
    expect(graduationProgress("300", "200")).toBe(100);
  });
});
