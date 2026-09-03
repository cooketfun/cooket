export const ARC_PROTOCOL_ECONOMICS_BLOCKER =
  "Arc financial execution is disabled until the verified trading periphery and testnet E2E release gate are approved.";

/** Fail-closed release gate; local address configuration never enables writes. */
export function assertArcProtocolEconomicsReady(): void {
  throw new Error(ARC_PROTOCOL_ECONOMICS_BLOCKER);
}
