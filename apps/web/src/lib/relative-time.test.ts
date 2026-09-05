import { describe, expect, it } from "vitest";
import { formatAbsoluteUTC, formatRelativeAge } from "./relative-time";

describe("token relative age", () => {
  it.each([
    [0, "0s"], [34, "34s"], [59, "59s"], [60, "1m"], [719, "11m"], [3_599, "59m"],
    [3_600, "1h"], [86_399, "23h"], [86_400, "1d"], [259_200, "3d"], [604_800, "1w"],
    [2_592_000, "1mo"],
  ])("formats %i seconds deterministically as %s", (elapsed, expected) => {
    expect(formatRelativeAge(1_000, 1_000 + elapsed)).toBe(expected);
  });

  it("clamps future timestamps and formats the absolute time in UTC", () => {
    expect(formatRelativeAge(2_000, 1_000)).toBe("0s");
    expect(formatAbsoluteUTC(1_788_509_400)).toMatch(/Sep .*2026.*UTC/);
  });
});
