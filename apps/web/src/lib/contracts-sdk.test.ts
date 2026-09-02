import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from "viem";
import {
  computeArcCandidateSalt,
  computeArcLaunchSeed,
  computeArcTokenInitCodeHash,
  encodeBuy,
  encodeCreateToken,
  encodeSell,
  FIXED_TOKEN_SUPPLY,
  maxInputWithSlippage,
  minOutputWithSlippage,
  parseTokenLaunchedReceipt,
  parseTradeReceipt,
  predictArcTokenAddress,
  cooketCurveAbi,
  cooketFactoryAbi,
} from "@cooket/contracts-sdk";
import { assertBuyQuoteFresh } from "./contracts";

const factory = "0x11657C36DDa4F6E9C4b6d73ed56DF91d65d500E4" as const;
const token = "0x0000000000000000000000000000000000000011" as const;
const creator = "0x0000000000000000000000000000000000000022" as const;
const curve = "0x0000000000000000000000000000000000000033" as const;

describe("factory SDK", () => {
  it("encodes the exact atomic createToken signature", () => {
    expect(decodeFunctionData({ abi: cooketFactoryAbi, data: encodeCreateToken("Cooket", "ZK", `0x${"01".repeat(32)}`) })).toEqual({
      functionName: "createToken",
      args: ["Cooket", "ZK", `0x${"01".repeat(32)}`],
    });
  });

  it("decodes the canonical TokenLaunchedV3 receipt", () => {
    const topics = encodeEventTopics({ abi: cooketFactoryAbi, eventName: "TokenLaunchedV3", args: { creator, token, curve } });
    const data = encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint16" }],
      ["endpoint-cp-v3", FIXED_TOKEN_SUPPLY, BigInt("800000000000000000000000000"), BigInt("200000000000000000000000000"), creator, "0x0000000000000000000000000000000000000044", `0x${"02".repeat(32)}`, `0x${"03".repeat(32)}`, 0],
    );
    const logTopics = topics.filter((topic): topic is Hex => typeof topic === "string");
    expect(parseTokenLaunchedReceipt({ status: "success", logs: [{ address: factory, data, topics: logTopics }] }, factory)).toMatchObject({
      token: getAddress(token), curve: getAddress(curve), creator: getAddress(creator), protocolVersion: "endpoint-cp-v3", totalSupply: FIXED_TOKEN_SUPPLY,
    });
  });

  it("rejects malformed and reverted creation receipts", () => {
    expect(() => parseTokenLaunchedReceipt({ status: "success", logs: [] }, factory)).toThrow(/exactly one/);
    expect(() => parseTokenLaunchedReceipt({ status: "reverted", logs: [] }, factory)).toThrow(/reverted/);
  });

  it("matches the Solidity COOKET_ARC_V1 CREATE2 parity vector", () => {
    const vectorFactory = "0x1111111111111111111111111111111111111111";
    const vectorCreator = "0x2222222222222222222222222222222222222222";
    const vectorDeployer = "0x3333333333333333333333333333333333333333";
    const userSalt = `0x${"01".repeat(32)}` as Hex;
    const launchSeed = computeArcLaunchSeed(vectorFactory, vectorCreator, userSalt, "Arc Parity", "ARC");
    const candidateSalt = computeArcCandidateSalt(launchSeed, 255);
    const initCodeHash = computeArcTokenInitCodeHash(
      "0x60006000",
      vectorFactory,
      vectorCreator,
      "Arc Parity",
      "ARC",
    );

    expect(launchSeed).toBe("0x8bfcbd3026b9d4a396ae8384900c59e752867e927aad0516a06588ed82d9588a");
    expect(candidateSalt).toBe("0xd952abbd02333a51f2ccc168a65eb9f8c61943d9da078e8b4f7876104f76806a");
    expect(initCodeHash).toBe("0x848b9c6ad3911a15a45bf3091f5b234708a3d45faae4b3972836ba9274722d9b");
    expect(predictArcTokenAddress(vectorDeployer, candidateSalt, initCodeHash)).toBe(
      getAddress("0x4f0Cb6536e068a3e0c7305bD87b94EBc95127e6c"),
    );
    expect(() => computeArcCandidateSalt(launchSeed, 256)).toThrow(/0 through 255/);
  });
});

describe("curve trade SDK", () => {
  it("rejects stale protected buy quotes", () => {
    expect(() => assertBuyQuoteFresh({ deadline: BigInt(Math.floor(Date.now() / 1000) - 1) })).toThrow(/expired/i);
  });

  it("encodes exact buy and sell arguments", () => {
    expect(decodeFunctionData({ abi: cooketCurveAbi, data: encodeBuy(BigInt(12), BigInt(99)) })).toEqual({ functionName: "buy", args: [BigInt(12), BigInt(99)] });
    expect(decodeFunctionData({ abi: cooketCurveAbi, data: encodeSell(BigInt(56), BigInt(78), BigInt(99)) })).toEqual({ functionName: "sell", args: [BigInt(56), BigInt(78), BigInt(99)] });
  });

  it("applies conservative basis-point slippage rounding", () => {
    expect(maxInputWithSlippage(BigInt(101), 100)).toBe(BigInt(103));
    expect(minOutputWithSlippage(BigInt(101), 100)).toBe(BigInt(99));
    expect(() => maxInputWithSlippage(BigInt(1), 5001)).toThrow(/between 0% and 50%/);
  });

  it.each([
    ["buy" as const, "TokensBought" as const, "buyer" as const],
    ["sell" as const, "TokensSold" as const, "seller" as const],
  ])("decodes the exact %s event", (side, eventName, traderField) => {
    const topics = encodeEventTopics({ abi: cooketCurveAbi, eventName, args: { token, [traderField]: creator } });
    const data = side === "buy"
      ? encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [BigInt(10), BigInt(11), BigInt(12), BigInt(13), BigInt(3), BigInt(2), BigInt(1), BigInt(0), BigInt(0), BigInt(3)],
      )
      : encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [BigInt(10), BigInt(11), BigInt(12), BigInt(3), BigInt(2), BigInt(1), BigInt(0), BigInt(0)],
      );
    const logTopics = topics.filter((topic): topic is Hex => typeof topic === "string");
    expect(parseTradeReceipt({ status: "success", logs: [{ address: curve, data, topics: logTopics }] }, curve, side)).toMatchObject({
      side,
      token: getAddress(token),
      trader: getAddress(creator),
      tokenAmount: side === "buy" ? BigInt(13) : BigInt(10),
      protocolFee: BigInt(1),
      creatorFee: BigInt(2),
      totalFee: BigInt(3),
    });
  });

  it("rejects failed and malformed trade receipts", () => {
    expect(() => parseTradeReceipt({ status: "reverted", logs: [] }, curve, "buy")).toThrow(/reverted/);
    expect(() => parseTradeReceipt({ status: "success", logs: [] }, curve, "sell")).toThrow(/exactly one/);
  });
});
