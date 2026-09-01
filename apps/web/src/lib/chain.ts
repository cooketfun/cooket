import {
  ARC_TESTNET_CHAIN_ID,
} from "@cooket/contracts-sdk";
import type { Address } from "viem";
import { arcTestnet } from "viem/chains";

const configuredChainId = process.env.NEXT_PUBLIC_COOKET_CHAIN_ID?.trim() || String(ARC_TESTNET_CHAIN_ID);
if (configuredChainId !== String(ARC_TESTNET_CHAIN_ID)) throw new Error(`Cooket Arc web requires Arc Testnet chain ID ${ARC_TESTNET_CHAIN_ID}; received ${configuredChainId}.`);

if (arcTestnet.id !== ARC_TESTNET_CHAIN_ID) throw new Error("Web viem Arc Testnet metadata is inconsistent.");
export const selectedCooketChain = arcTestnet;
export const selectedCooketChainId = selectedCooketChain.id;
export const selectedCooketChainName = selectedCooketChain.name;
export const selectedCooketExplorer = selectedCooketChain.blockExplorers.default.url;
export const selectedCooketRPCURL = process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL?.trim() || "https://rpc.testnet.arc.io";
export const selectedCooketWebSocketURL = "wss://rpc.testnet.arc.io";

export function isSelectedCooketChain(chainId: number | undefined): boolean {
  return chainId === selectedCooketChainId;
}
export function explorerTransactionURL(hash: string): string { return `${selectedCooketExplorer}/tx/${hash}`; }
export function explorerAddressURL(address: string): string { return `${selectedCooketExplorer}/address/${address}`; }
export function validAddress(value: string): value is Address { return /^0x[0-9a-fA-F]{40}$/.test(value); }
