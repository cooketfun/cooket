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
  COOKET_V4_PROTOCOL_VERSION_HASH,
  COOKET_V4_CTO_POLICY_HASH,
  COOKET_V4_CTO_DOMAIN,
  V4_VIRTUAL_TOKEN_RESERVE,
  V4_VIRTUAL_NATIVE_USDC_RESERVE,
  V4_K,
  V4_GRADUATION_NATIVE_USDC_RESERVE,
  V4_EXACT_GRADUATION_GROSS_NATIVE_USDC,
  V4_INITIAL_NATIVE_USDC_PRICE,
  V4_TERMINAL_NATIVE_USDC_PRICE,
  V4_GRADUATION_USDC_BASE_UNITS,
  computeV4CTOProposalId,
  computeV4CTOTreasurySalt,
  cooketCurveV4Abi,
  ctoRegistryV4Abi,
  ctoTreasuryV4Abi,
  feeManagerV4Abi,
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
  const names = new Set<string>(all.map((item) => item.name));
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

test("V4 identifiers and doubled economics match locked literals", () => {
  assert.equal(COOKET_V4_PROTOCOL_VERSION_HASH, keccak256(stringToHex("endpoint-cp-v4")));
  assert.equal(COOKET_V4_CTO_POLICY_HASH, keccak256(stringToHex("cooket-voluntary-cto-v2")));
  assert.equal(COOKET_V4_CTO_DOMAIN, keccak256(stringToHex("COOKET_VOLUNTARY_CTO_V2")));
  assert.equal(V4_VIRTUAL_TOKEN_RESERVE, 1_066_666_666_666_666_666_666_666_667n);
  assert.equal(V4_VIRTUAL_NATIVE_USDC_RESERVE, 4_830n * 10n ** 18n);
  assert.equal(V4_K, BigInt("5152000000000000000000000001610000000000000000000"));
  assert.equal(V4_GRADUATION_NATIVE_USDC_RESERVE, 14_490n * 10n ** 18n);
  assert.equal(V4_EXACT_GRADUATION_GROSS_NATIVE_USDC, 14_636_363_636_363_636_363_636n);
  assert.equal(V4_EXACT_GRADUATION_GROSS_NATIVE_USDC / 100n, 146_363_636_363_636_363_636n);
  assert.equal(V4_EXACT_GRADUATION_GROSS_NATIVE_USDC - V4_EXACT_GRADUATION_GROSS_NATIVE_USDC / 100n, V4_GRADUATION_NATIVE_USDC_RESERVE);
  assert.equal(V4_INITIAL_NATIVE_USDC_PRICE, 4_528_125_000_000n);
  assert.equal(V4_TERMINAL_NATIVE_USDC_PRICE, 72_450_000_000_000n);
  assert.equal(V4_GRADUATION_USDC_BASE_UNITS, 14_490_000_000n);
});

test("V4 CTO helpers require an explicit chain ID and match Solidity encoding", () => {
  const chainId = 123456789n;
  const nonce = 4n;
  assert.equal(computeV4CTOTreasurySalt(chainId, registry, token, controller, nonce), keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint64" }],
    [COOKET_V4_CTO_DOMAIN, chainId, registry, token, controller, nonce],
  )));
  assert.equal(computeV4CTOProposalId(chainId, registry, token, nonce, treasury, controller, metadataHash), keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
    [COOKET_V4_CTO_DOMAIN, chainId, registry, token, nonce, treasury, controller, metadataHash],
  )));
});

test("V4 ABI exposes atomic confirmation and removes delayed execution", () => {
  const all = [...cooketCurveV4Abi, ...feeManagerV4Abi, ...ctoRegistryV4Abi, ...ctoTreasuryV4Abi];
  const names = new Set<string>(all.map((item) => item.name));
  for (const required of ["confirmCTO", "CTOConfirmed", "CTOActivated", "CTOConfirmationSubmitted"]) {
    assert.equal(names.has(required), true, required);
  }
  for (const removed of ["acceptCTO", "executeCTO", "CTOAccepted", "CTOReady", "EXECUTION_DELAY", "EXECUTION_GRACE_PERIOD"]) {
    assert.equal(names.has(removed), false, removed);
  }
});
