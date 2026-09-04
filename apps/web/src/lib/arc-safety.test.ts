import { afterEach, describe, expect, it, vi } from "vitest";
import { ARC_PROTOCOL_ECONOMICS_BLOCKER, ARC_TESTNET_FINANCIAL_EXECUTION_ENV, assertArcProtocolEconomicsReady, isArcTestnetFinancialExecutionEnabled } from "./arc-safety";

const testnet = { chainId: 5042002, chainName: "Arc Testnet" } as const;

describe("Arc Testnet financial execution gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when the explicit testnet flag is missing", () => {
    vi.stubEnv(ARC_TESTNET_FINANCIAL_EXECUTION_ENV, "");
    expect(() => assertArcProtocolEconomicsReady()).toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
  });

  it("allows writes only on Arc Testnet when the explicit flag is true", () => {
    vi.stubEnv(ARC_TESTNET_FINANCIAL_EXECUTION_ENV, "true");
    vi.stubEnv("NEXT_PUBLIC_COOKET_CHAIN_ID", "5042002");
    expect(() => assertArcProtocolEconomicsReady()).not.toThrow();
  });

  it("fails closed when the explicit flag is false", () => {
    vi.stubEnv(ARC_TESTNET_FINANCIAL_EXECUTION_ENV, "false");
    vi.stubEnv("NEXT_PUBLIC_COOKET_CHAIN_ID", "5042002");
    expect(() => assertArcProtocolEconomicsReady()).toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
  });

  it("fails closed for a true flag on the wrong chain", () => {
    expect(isArcTestnetFinancialExecutionEnabled({ ...testnet, chainId: 8453, flag: "true" })).toBe(false);
    expect(isArcTestnetFinancialExecutionEnabled({ ...testnet, chainId: 1, flag: "true" })).toBe(false);
    expect(isArcTestnetFinancialExecutionEnabled({ chainId: 5042002, chainName: "Arc Mainnet", flag: "true" })).toBe(false);
    vi.stubEnv(ARC_TESTNET_FINANCIAL_EXECUTION_ENV, "true");
    vi.stubEnv("NEXT_PUBLIC_COOKET_CHAIN_ID", "8453");
    expect(() => assertArcProtocolEconomicsReady()).toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
  });

  it("fails closed for malformed or unexpected configuration", () => {
    expect(isArcTestnetFinancialExecutionEnabled({ ...testnet, flag: "TRUE" })).toBe(false);
    expect(isArcTestnetFinancialExecutionEnabled({ ...testnet, flag: "1" })).toBe(false);
    expect(isArcTestnetFinancialExecutionEnabled({ ...testnet, flag: "yes" })).toBe(false);
    expect(isArcTestnetFinancialExecutionEnabled({ ...testnet, flag: " true" })).toBe(true);
    expect(isArcTestnetFinancialExecutionEnabled({ ...testnet, flag: "true", configuredChainId: "5.042002e6" })).toBe(false);
    expect(isArcTestnetFinancialExecutionEnabled({ ...testnet, flag: "true", configuredChainId: "5042002" })).toBe(true);
    vi.stubEnv(ARC_TESTNET_FINANCIAL_EXECUTION_ENV, "TRUE");
    vi.stubEnv("NEXT_PUBLIC_COOKET_CHAIN_ID", "5042002");
    expect(() => assertArcProtocolEconomicsReady()).toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
  });
});
