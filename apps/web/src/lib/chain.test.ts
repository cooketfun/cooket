import { describe, expect, it } from "vitest";
import { isSelectedCooketChain, selectedCooketChainId, validAddress } from "./chain";
import { ARC_TESTNET_CHAIN_ID, ARC_NATIVE_CURRENCY_DECIMALS, ARC_USDC_TOKEN_DECIMALS, resolveCooketChain } from "@cooket/contracts-sdk";

describe("chain guard", () => {
  it("recognizes only the configured Cooket chain", () => {
    expect(ARC_TESTNET_CHAIN_ID).toBe(5042002);
    expect(isSelectedCooketChain(selectedCooketChainId)).toBe(true);
    expect(isSelectedCooketChain(84532)).toBe(false);
    expect(isSelectedCooketChain(undefined)).toBe(false);
  });
  it("resolves only Arc Testnet and separates native from ERC-20 precision", () => {
    const arc = resolveCooketChain(5042002);
    expect(arc.id).toBe(ARC_TESTNET_CHAIN_ID);
    expect(arc.blockExplorers.default.url).toBe("https://testnet.arcscan.app");
    expect(arc.nativeCurrency).toEqual({ name: "USDC", symbol: "USDC", decimals: 18 });
    expect(ARC_NATIVE_CURRENCY_DECIMALS).toBe(18);
    expect(ARC_USDC_TOKEN_DECIMALS).toBe(6);
    expect(() => resolveCooketChain("84532")).toThrow("Unsupported Cooket chain ID");
    expect(() => resolveCooketChain("8453")).toThrow("Unsupported Cooket chain ID");
    expect(() => resolveCooketChain("1")).toThrow("Unsupported Cooket chain ID");
    expect(() => resolveCooketChain("invalid")).toThrow("Unsupported Cooket chain ID");
    expect(() => resolveCooketChain("5.042002e6")).toThrow("Unsupported Cooket chain ID");
  });
  it("validates addresses", () => {
    expect(validAddress("0x0000000000000000000000000000000000000001")).toBe(true);
    expect(validAddress("0x123")).toBe(false);
    expect(validAddress("not-an-address")).toBe(false);
  });
});
