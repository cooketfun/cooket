import { defineChain } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { cookieStorage, createStorage, http } from "wagmi";
import {
  selectedCooketChainId,
  selectedCooketChainName,
  selectedCooketExplorer,
  selectedCooketRPCURL,
  selectedCooketWebSocketURL,
} from "@/lib/chain";

export const ARC_TESTNET_CAIP_NETWORK_ID = `eip155:${selectedCooketChainId}` as const;

export const arcTestnetAppKitNetwork = defineChain({
  id: selectedCooketChainId,
  caipNetworkId: ARC_TESTNET_CAIP_NETWORK_ID,
  chainNamespace: "eip155",
  name: selectedCooketChainName,
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [selectedCooketRPCURL],
      webSocket: [selectedCooketWebSocketURL],
    },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: selectedCooketExplorer },
  },
  testnet: true,
});

export const appKitNetworks = [arcTestnetAppKitNetwork] as const;

export const appKitFeatures = {
  email: false,
  socials: false,
  swaps: false,
  onramp: false,
  send: false,
  receive: false,
  history: false,
  analytics: false,
  reownAuthentication: false,
  connectMethodsOrder: ["wallet"],
} as const;

export type ReownProjectConfiguration =
  | { configured: true; projectId: string }
  | { configured: false; reason: string };

export function resolveReownProjectId(value: string | undefined): ReownProjectConfiguration {
  const projectId = value?.trim() ?? "";
  if (!projectId) return { configured: false, reason: "NEXT_PUBLIC_REOWN_PROJECT_ID is missing." };
  if (/replace|example|your[_-]?(reown|project)|changeme/i.test(projectId)) {
    return { configured: false, reason: "NEXT_PUBLIC_REOWN_PROJECT_ID still contains a placeholder." };
  }
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(projectId)) {
    return { configured: false, reason: "NEXT_PUBLIC_REOWN_PROJECT_ID has an invalid format." };
  }
  return { configured: true, projectId };
}

export type AppMetadataConfiguration = {
  name: string;
  description: string;
  url: string;
  icons: string[];
};

export function resolveAppMetadata(nameValue: string | undefined, urlValue: string | undefined): AppMetadataConfiguration {
  const name = nameValue?.trim() || "Cooket";
  const url = urlValue?.trim() || "https://testnet.cooket.fun";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be an absolute http(s) URL for Reown AppKit metadata.");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("NEXT_PUBLIC_APP_URL must use http or https for Reown AppKit metadata.");
  }
  return {
    name,
    description: "Cooket is an Arc-native token launch protocol in testnet development.",
    url: parsed.origin,
    icons: [`${parsed.origin}/brand/cooket-icon.png`],
  };
}

export const reownProject = resolveReownProjectId(process.env.NEXT_PUBLIC_REOWN_PROJECT_ID);
export const appKitMetadata = resolveAppMetadata(process.env.NEXT_PUBLIC_APP_NAME, process.env.NEXT_PUBLIC_APP_URL);

// Keep unrelated SSR and build work importable without live wallet
// configuration. The provider boundary prevents this inert value from opening
// AppKit when the public project ID is missing.
const adapterProjectId = reownProject.configured ? reownProject.projectId : "00000000000000000000000000000000";

export const wagmiAdapter = new WagmiAdapter({
  networks: [...appKitNetworks],
  projectId: adapterProjectId,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [selectedCooketChainId]: http(selectedCooketRPCURL),
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const ARC_TESTNET_ADD_CHAIN_PARAMETER = {
  chainId: `0x${selectedCooketChainId.toString(16)}`,
  chainName: selectedCooketChainName,
  nativeCurrency: arcTestnetAppKitNetwork.nativeCurrency,
  rpcUrls: [selectedCooketRPCURL],
  blockExplorerUrls: [selectedCooketExplorer],
} as const;

export type ExternalEip1193Provider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

export async function switchExternalWalletToArc(provider: ExternalEip1193Provider): Promise<void> {
  const switchRequest = {
    method: "wallet_switchEthereumChain",
    params: [{ chainId: ARC_TESTNET_ADD_CHAIN_PARAMETER.chainId }],
  } as const;
  try {
    await provider.request(switchRequest);
  } catch (reason) {
    if (providerErrorCode(reason) !== 4902) throw reason;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [ARC_TESTNET_ADD_CHAIN_PARAMETER],
    });
    await provider.request(switchRequest);
  }
}

export function canUseActiveWallet(chainId: number | undefined, connected: boolean) {
  return connected && chainId === selectedCooketChainId;
}

/** @deprecated Use canUseActiveWallet. */
export const canUseBrowserWallet = canUseActiveWallet;

function providerErrorCode(reason: unknown): number | undefined {
  if (!reason || typeof reason !== "object") return undefined;
  const code = Reflect.get(reason, "code");
  if (typeof code === "number") return code;
  const cause = Reflect.get(reason, "cause");
  return cause === reason ? undefined : providerErrorCode(cause);
}
