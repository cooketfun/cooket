export const ARC_PROTOCOL_ECONOMICS_BLOCKER =
  "Arc financial execution is disabled until native-USDC economics, pricing, graduation liquidity, and deployment governance are approved.";

/** Phase 0 fail-closed gate for every contract write using Base-derived economics. */
export function assertArcProtocolEconomicsReady(): void {
  throw new Error(ARC_PROTOCOL_ECONOMICS_BLOCKER);
}
