import { describe, expect, it } from "vitest";
import { ARC_PROTOCOL_ECONOMICS_BLOCKER, assertArcProtocolEconomicsReady } from "./arc-safety";

describe("Arc Phase 0 financial guard", () => {
  it("fails closed instead of executing Base-derived economics", () => {
    expect(() => assertArcProtocolEconomicsReady()).toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
  });
});
