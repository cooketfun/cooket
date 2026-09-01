import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Arc Testnet frontend configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_COOKET_CHAIN_ID", "5042002");
    vi.stubEnv("NEXT_PUBLIC_ARC_TESTNET_RPC_URL", "https://arc.invalid");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("selects Arc Testnet chain, RPC, explorer, and native metadata", async () => {
    const chain = await import("./chain");
    expect(chain.selectedCooketChainId).toBe(5042002);
    expect(chain.selectedCooketChainName).toBe("Arc Testnet");
    expect(chain.selectedCooketRPCURL).toBe("https://arc.invalid");
    expect(chain.selectedCooketChain.nativeCurrency).toEqual({ name: "USDC", symbol: "USDC", decimals: 18 });
    expect(chain.explorerTransactionURL("0xabc")).toBe("https://testnet.arcscan.app/tx/0xabc");
    expect(chain.explorerAddressURL("0x123")).toBe("https://testnet.arcscan.app/address/0x123");
  });

  it("ignores inherited Base Uniswap configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_QUOTER_V2", "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a");
    vi.stubEnv("NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_SWAP_ROUTER_02", "0x2626664c2603336E57B271c5C0b26F421741e481");
    vi.stubEnv("NEXT_PUBLIC_BASE_MAINNET_UNISWAP_V3_FACTORY", "0x33128a8fC17869897dcE68Ed026d694621f6FDfD");
    vi.stubEnv("NEXT_PUBLIC_BASE_SEPOLIA_UNISWAP_V3_FACTORY", "0x0000000000000000000000000000000000000001");
    const uniswap = await import("./uniswap-v3");
    expect(uniswap.configuredUniswapV3()).toBeUndefined();
  });
});
