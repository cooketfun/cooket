import { ctoRegistryV3Abi, ctoTreasuryV3Abi } from "@cooket/contracts-sdk";
import { decodeFunctionData, encodeFunctionData, keccak256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { buildCTOAcceptancePayload, requireDeployedController, resolveCTOMetadata, validateControllerAddress } from "./cto-transactions";

const treasury = "0x00000000000000000000000000000000000000cc";
const proposalId = `0x${"ab".repeat(32)}` as const;

describe("CTO transaction inputs", () => {
  it("derives the exact registry metadata hash without asking the user", () => {
    expect(resolveCTOMetadata(" ipfs://cooket/cto ")).toEqual({
      metadataURI: "ipfs://cooket/cto",
      metadataHash: keccak256(stringToBytes("ipfs://cooket/cto")),
    });
    expect(resolveCTOMetadata(" ").metadataHash).toBe(`0x${"00".repeat(32)}`);
  });

  it("rejects malformed and zero controllers", () => {
    expect(() => validateControllerAddress("not-an-address")).toThrow(/valid EVM/i);
    expect(() => validateControllerAddress("0x0000000000000000000000000000000000000000")).toThrow(/zero/i);
  });

  it("rejects an EOA controller and accepts deployed contract bytecode", () => {
    expect(() => requireDeployedController(treasury, "0x")).toThrow(/deployed contract/i);
    expect(requireDeployedController(treasury, "0x6000")).toBe(treasury);
  });

  it("builds the exact controller-wallet acceptance payload", () => {
    const payload = buildCTOAcceptancePayload(treasury, proposalId);
    expect(payload.target).toBe("0x00000000000000000000000000000000000000cc");
    expect(payload.value).toBe(BigInt(0));
    expect(decodeFunctionData({ abi: ctoTreasuryV3Abi, data: payload.data })).toEqual({ functionName: "acceptCTO", args: [proposalId] });
  });

  it.each(["cancelCTO", "expireCTO", "executeCTO"] as const)("encodes the exact %s registry call", (functionName) => {
    const data = encodeFunctionData({ abi: ctoRegistryV3Abi, functionName, args: [proposalId] });
    expect(decodeFunctionData({ abi: ctoRegistryV3Abi, data })).toEqual({ functionName, args: [proposalId] });
  });

  it("encodes proposeCTO with the derived metadata hash", () => {
    const token = "0x00000000000000000000000000000000000000AA";
    const controller = "0x00000000000000000000000000000000000000dd";
    const metadata = resolveCTOMetadata("ipfs://cooket/cto");
    const data = encodeFunctionData({ abi: ctoRegistryV3Abi, functionName: "proposeCTO", args: [token, controller, metadata.metadataHash, metadata.metadataURI] });
    expect(decodeFunctionData({ abi: ctoRegistryV3Abi, data })).toEqual({ functionName: "proposeCTO", args: [token, controller, metadata.metadataHash, metadata.metadataURI] });
  });

  it("rejects metadata URIs longer than the contract byte limit", () => {
    expect(() => resolveCTOMetadata("ü".repeat(129))).toThrow(/256 UTF-8 bytes/i);
  });
});
