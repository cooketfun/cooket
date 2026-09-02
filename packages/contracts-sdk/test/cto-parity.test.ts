import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, getCreate2Address, keccak256, stringToHex } from "viem";
import {
  ARC_CANONICAL_USDC,
  ARC_TESTNET_CHAIN_ID,
  COOKET_CTO_DOMAIN,
  COOKET_CTO_POLICY_HASH,
  computeCTOProposalId,
  computeCTOTreasurySalt,
  cooketCurveAbi,
  ctoRegistryV3Abi,
  ctoTreasuryV3Abi,
  feeManagerV3Abi,
  predictCTOTreasuryAddress,
} from "../src/index.ts";

const registry = "0x1000000000000000000000000000000000000001";
const token = "0x2000000000000000000000000000000000000002";
const controller = "0x3000000000000000000000000000000000000003";
const treasury = "0x4000000000000000000000000000000000000004";
const metadataHash = keccak256(stringToHex("ipfs://agreement"));

test("CTO policy and domain constants match Solidity literals", () => {
  assert.equal(COOKET_CTO_POLICY_HASH, keccak256(stringToHex("cooket-voluntary-cto-v1")));
  assert.equal(COOKET_CTO_DOMAIN, keccak256(stringToHex("COOKET_VOLUNTARY_CTO_V1")));
});

test("CTO salt and proposal ID use uint64 nonce and Arc chain domain", () => {
  const nonce = 9n;
  const salt = computeCTOTreasurySalt(registry, token, controller, nonce);
  assert.equal(salt, keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint64" }],
    [COOKET_CTO_DOMAIN, BigInt(ARC_TESTNET_CHAIN_ID), registry, token, controller, nonce],
  )));
  const proposalId = computeCTOProposalId(registry, token, nonce, treasury, controller, metadataHash);
  assert.equal(proposalId, keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
    [COOKET_CTO_DOMAIN, BigInt(ARC_TESTNET_CHAIN_ID), registry, token, nonce, treasury, controller, metadataHash],
  )));
  assert.throws(() => computeCTOTreasurySalt(registry, token, controller, 1n << 64n), /uint64/);
});

test("treasury CREATE2 preview includes exact constructor arguments", () => {
  const creationCode = "0x60006000";
  const nonce = 3n;
  const constructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }],
    [registry, token, controller, ARC_CANONICAL_USDC],
  );
  const expected = getCreate2Address({
    from: registry,
    salt: computeCTOTreasurySalt(registry, token, controller, nonce),
    bytecodeHash: keccak256(`${creationCode}${constructorArgs.slice(2)}`),
  });
  assert.equal(predictCTOTreasuryAddress(creationCode, registry, token, controller, ARC_CANONICAL_USDC, nonce), expected);
});

test("selected ABI exposes exact CTO and native-USDC names without WETH", () => {
  const all = [...cooketCurveAbi, ...feeManagerV3Abi, ...ctoRegistryV3Abi, ...ctoTreasuryV3Abi];
  const names = new Set(all.map((item) => item.name));
  for (const required of [
    "nativeUsdcAmount", "ctoRegistry", "ctoActive", "proposeCTO", "executeCTO", "acceptCTO", "transferAsset",
    "CTOTreasuryDeployed", "CTOProposed", "CTOAccepted", "CTOReady", "CTOCancelled", "CTOExpired", "CTOActivated",
    "CreatorFeeCheckpointed", "PendingCreatorPayoutInvalidated", "CTOFeeRouteActivated", "CheckpointedCreatorFeesClaimed",
    "CTOAcceptanceSubmitted", "SupportedAssetRegistered", "TreasuryAssetTransferred", "CreatorFeesPulled",
  ]) {
    assert.ok(required === "nativeUsdcAmount"
      ? cooketCurveAbi.some((item) => item.type === "event" && item.name === "Graduated" && item.inputs.some((input) => input.name === required))
      : names.has(required), required);
  }
  assert.equal(names.has("CheckpointedFeesClaimed"), false);
  assert.equal(names.has("PendingPayoutInvalidated"), false);
  assert.equal(JSON.stringify(all).toLowerCase().includes("weth"), false);
});

