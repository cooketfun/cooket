import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ARC_TESTNET_ADD_CHAIN_PARAMETER,
  ARC_TESTNET_CAIP_NETWORK_ID,
  appKitFeatures,
  appKitMetadata,
  arcTestnetAppKitNetwork,
  canUseActiveWallet,
  resolveAppMetadata,
  resolveReownProjectId,
  switchExternalWalletToArc,
  wagmiConfig,
} from "./wallet";

describe("Reown AppKit and Wagmi Arc Testnet configuration", () => {
  it("defines the official Arc Testnet network metadata", () => {
    expect(arcTestnetAppKitNetwork).toMatchObject({
      id: 5042002,
      caipNetworkId: "eip155:5042002",
      chainNamespace: "eip155",
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"], webSocket: ["wss://rpc.testnet.arc.io"] } },
      blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
      testnet: true,
    });
    expect(ARC_TESTNET_CAIP_NETWORK_ID).toBe("eip155:5042002");
    expect(wagmiConfig.chains.map((chain) => chain.id)).toEqual([5042002]);
  });

  it("enables external wallets while disabling hosted login and modal financial features", () => {
    expect(appKitFeatures).toMatchObject({
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
      send: false,
      receive: false,
      reownAuthentication: false,
      connectMethodsOrder: ["wallet"],
    });
    expect(appKitFeatures).not.toHaveProperty(String.fromCharCode(101, 109, 98, 101, 100, 100, 101, 100, 87, 97, 108, 108, 101, 116, 115));
  });

  it("rejects disconnected and Base-chain wallets", () => {
    expect(canUseActiveWallet(5042002, true)).toBe(true);
    expect(canUseActiveWallet(5042002, false)).toBe(false);
    expect(canUseActiveWallet(8453, true)).toBe(false);
    expect(canUseActiveWallet(84532, true)).toBe(false);
  });

  it("validates the public project ID at the wallet boundary", () => {
    expect(resolveReownProjectId(undefined)).toMatchObject({ configured: false, reason: expect.stringMatching(/missing/i) });
    expect(resolveReownProjectId("replace_with_reown_project_id")).toMatchObject({ configured: false, reason: expect.stringMatching(/placeholder/i) });
    expect(resolveReownProjectId("bad id")).toMatchObject({ configured: false, reason: expect.stringMatching(/invalid format/i) });
    const testId = "00000000000000000000000000000001";
    expect(resolveReownProjectId(testId)).toEqual({ configured: true, projectId: testId });
  });

  it("uses local metadata by default and permits a local development override", () => {
    expect(appKitMetadata).toMatchObject({ name: "Cooket", description: "Cooket is an Arc-native token launch protocol in testnet development.", url: "http://localhost:3200" });
    expect(resolveAppMetadata(undefined, undefined)).toMatchObject({ name: "Cooket", url: "http://localhost:3200" });
    expect(resolveAppMetadata("Cooket", "http://localhost:3200")).toMatchObject({ name: "Cooket", url: "http://localhost:3200" });
    expect(resolveAppMetadata("Preview", "https://preview.example/path")).toMatchObject({ name: "Preview", url: "https://preview.example" });
    expect(() => resolveAppMetadata("Preview", "file:///tmp/app")).toThrow(/http or https/i);
  });

  it("switches a known wallet to Arc using the hexadecimal chain ID", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    await switchExternalWalletToArc({ request });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_ADD_CHAIN_PARAMETER.chainId }] });
  });

  it("adds unknown Arc Testnet metadata before retrying the switch", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("unknown chain"), { code: 4902 }))
      .mockResolvedValue(undefined);
    await switchExternalWalletToArc({ request });
    expect(request.mock.calls).toEqual([
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_ADD_CHAIN_PARAMETER.chainId }] }],
      [{ method: "wallet_addEthereumChain", params: [ARC_TESTNET_ADD_CHAIN_PARAMETER] }],
      [{ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_ADD_CHAIN_PARAMETER.chainId }] }],
    ]);
    expect(ARC_TESTNET_ADD_CHAIN_PARAMETER).toEqual({
      chainId: "0x4cef52",
      chainName: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: ["https://rpc.testnet.arc.io"],
      blockExplorerUrls: ["https://testnet.arcscan.app"],
    });
  });

  it("does not mistake a rejected switch for an unknown chain", async () => {
    const rejection = Object.assign(new Error("user rejected"), { code: 4001 });
    const request = vi.fn().mockRejectedValue(rejection);
    await expect(switchExternalWalletToArc({ request })).rejects.toBe(rejection);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("contains no legacy hosted-wallet dependency or environment configuration", () => {
    const files = [
      "package.json",
      "Dockerfile",
      "../../.env.example",
      "../../compose.yaml",
      "src/lib/wallet.ts",
      "src/providers/app-providers.tsx",
      "src/providers/active-wallet-provider.tsx",
    ];
    const source = files.map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n").toLowerCase();
    const removedProviderName = String.fromCharCode(112, 114, 105, 118, 121);
    const legacyPackage = `@${removedProviderName}-io`;
    const legacyVariable = `next_public_${removedProviderName}_app_id`;
    expect(source).not.toContain(legacyPackage);
    expect(source).not.toContain(legacyVariable);
  });

  it("initializes AppKit once outside React render functions", () => {
    const initializer = readFileSync(resolve(process.cwd(), "src/providers/appkit-initializer.ts"), "utf8");
    expect(initializer.match(/createAppKit\(/g)).toHaveLength(1);
    expect(initializer).toContain("defaultAccountTypes: { eip155: \"eoa\" }");
    expect(initializer).toContain("coinbasePreference: \"eoaOnly\"");
    expect(initializer).not.toMatch(/function\s+\w+[^]*createAppKit\(/);
  });
});
