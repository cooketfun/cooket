import { ARC_TESTNET_CHAIN_ID } from "@cooket/contracts-sdk";
import { selectedCooketChain, selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";

export const ARC_PROTOCOL_ECONOMICS_BLOCKER =
  "Arc financial execution is disabled until the verified trading periphery and testnet E2E release gate are approved.";

export const ARC_TESTNET_FINANCIAL_EXECUTION_ENV = "NEXT_PUBLIC_ARC_TESTNET_FINANCIAL_EXECUTION_ENABLED";

const ARC_TESTNET_CHAIN_NAME = "Arc Testnet";

function explicitTrue(value: string | undefined): boolean {
  return value?.trim() === "true";
}

/** Pure testnet write predicate. Arc Mainnet and unknown networks stay closed. */
export function isArcTestnetFinancialExecutionEnabled(input: {
  chainId: number;
  chainName: string;
  configuredChainId?: string;
  flag?: string;
}): boolean {
  const configured = input.configuredChainId?.trim();
  return explicitTrue(input.flag)
    && input.chainId === ARC_TESTNET_CHAIN_ID
    && input.chainName === ARC_TESTNET_CHAIN_NAME
    && (!configured || configured === String(ARC_TESTNET_CHAIN_ID));
}

/** Fail-closed release gate. Address configuration never enables writes. */
export function assertArcProtocolEconomicsReady(): void {
  if (
    selectedCooketChain.id !== selectedCooketChainId
    || !isArcTestnetFinancialExecutionEnabled({
      chainId: selectedCooketChainId,
      chainName: selectedCooketChainName,
      configuredChainId: process.env.NEXT_PUBLIC_COOKET_CHAIN_ID,
      flag: process.env[ARC_TESTNET_FINANCIAL_EXECUTION_ENV],
    })
  ) {
    throw new Error(ARC_PROTOCOL_ECONOMICS_BLOCKER);
  }
}
