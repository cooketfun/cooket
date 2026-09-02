import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet as viemArcTestnet } from "viem/chains";
import {
  cooketCurveAbi,
  cooketFactoryAbi,
  cooketTokenV3Abi,
  ctoRegistryV3Abi,
  ctoTreasuryV3Abi,
  feeManagerV3Abi,
  graduationManagerV3Abi,
  graduationSettlementExecutorV3Abi,
  permanentLPCustodianV3Abi,
  permanentLPCustodianDeployerV3Abi,
  permanentLPFeeVaultV3Abi,
} from "./abi.generated.ts";

export {
  cooketCurveAbi,
  cooketFactoryAbi,
  cooketTokenV3Abi,
  ctoRegistryV3Abi,
  ctoTreasuryV3Abi,
  feeManagerV3Abi,
  graduationManagerV3Abi,
  graduationSettlementExecutorV3Abi,
  permanentLPCustodianV3Abi,
  permanentLPCustodianDeployerV3Abi,
  permanentLPFeeVaultV3Abi,
} from "./abi.generated.ts";

export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_NATIVE_CURRENCY_DECIMALS = 18 as const;
export const ARC_USDC_TOKEN_DECIMALS = 6 as const;
export const ARC_NATIVE_USDC_UNIT = BigInt("1000000000000000000");
export const ARC_ERC20_USDC_UNIT = BigInt("1000000");
export const ARC_NATIVE_PER_ERC20_USDC_BASE_UNIT = BigInt("1000000000000");
export const ARC_CANONICAL_USDC = "0x3600000000000000000000000000000000000000" as const;
export const COOKET_ARC_V1_DOMAIN_HASH = keccak256(stringToHex("COOKET_ARC_V1"));
export const COOKET_CTO_POLICY_HASH = keccak256(stringToHex("cooket-voluntary-cto-v1"));
export const COOKET_CTO_DOMAIN = keccak256(stringToHex("COOKET_VOLUNTARY_CTO_V1"));
/** Historical test/reference constants. They are not supported runtime chains. */
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_MAINNET_CHAIN_ID = 8453 as const;
export type CooketChainId = typeof ARC_TESTNET_CHAIN_ID;
export const FIXED_TOKEN_SUPPLY = BigInt("1000000000000000000000000000");
export const CURVE_ALLOCATION = BigInt("800000000000000000000000000");
export const EXACT_GRADUATION_GROSS_NATIVE_USDC = BigInt("7318181818181818181818");

export function computeArcLaunchSeed(
  factory: Address,
  creator: Address,
  userSalt: Hex,
  name: string,
  symbol: string,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        COOKET_ARC_V1_DOMAIN_HASH,
        BigInt(ARC_TESTNET_CHAIN_ID),
        getAddress(factory),
        getAddress(creator),
        userSalt,
        keccak256(stringToHex(name)),
        keccak256(stringToHex(symbol)),
      ],
    ),
  );
}

export function computeArcCandidateSalt(launchSeed: Hex, attemptIndex: number): Hex {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0 || attemptIndex > 255) {
    throw new Error("Arc token candidate index must be an integer from 0 through 255.");
  }
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "uint16" }], [launchSeed, attemptIndex]),
  );
}

export function computeArcTokenInitCodeHash(
  tokenCreationCode: Hex,
  factory: Address,
  creator: Address,
  name: string,
  symbol: string,
): Hex {
  const constructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "string" }, { type: "string" }],
    [getAddress(factory), getAddress(creator), name, symbol],
  );
  return keccak256(concatHex([tokenCreationCode, constructorArgs]));
}

export function predictArcTokenAddress(
  tokenDeployer: Address,
  candidateSalt: Hex,
  tokenInitCodeHash: Hex,
): Address {
  return getCreate2Address({ from: getAddress(tokenDeployer), salt: candidateSalt, bytecodeHash: tokenInitCodeHash });
}

function requireUint64(value: bigint, label: string): bigint {
  if (value < 0n || value > 18_446_744_073_709_551_615n) throw new Error(`${label} must fit uint64.`);
  return value;
}

export function computeCTOTreasurySalt(
  registry: Address,
  token: Address,
  controller: Address,
  tokenNonce: bigint,
  chainId: bigint = BigInt(ARC_TESTNET_CHAIN_ID),
): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint64" }],
    [COOKET_CTO_DOMAIN, chainId, getAddress(registry), getAddress(token), getAddress(controller), requireUint64(tokenNonce, "tokenNonce")],
  ));
}

export function predictCTOTreasuryAddress(
  treasuryCreationCode: Hex,
  registry: Address,
  token: Address,
  controller: Address,
  canonicalUsdc: Address,
  tokenNonce: bigint,
  chainId: bigint = BigInt(ARC_TESTNET_CHAIN_ID),
): Address {
  const constructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }],
    [getAddress(registry), getAddress(token), getAddress(controller), getAddress(canonicalUsdc)],
  );
  return getCreate2Address({
    from: getAddress(registry),
    salt: computeCTOTreasurySalt(registry, token, controller, tokenNonce, chainId),
    bytecodeHash: keccak256(concatHex([treasuryCreationCode, constructorArgs])),
  });
}

export function computeCTOProposalId(
  registry: Address,
  token: Address,
  tokenNonce: bigint,
  treasury: Address,
  controller: Address,
  resolvedMetadataHash: Hex,
  chainId: bigint = BigInt(ARC_TESTNET_CHAIN_ID),
): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
    [COOKET_CTO_DOMAIN, chainId, getAddress(registry), getAddress(token), requireUint64(tokenNonce, "tokenNonce"), getAddress(treasury), getAddress(controller), resolvedMetadataHash],
  ));
}

if (viemArcTestnet.id !== ARC_TESTNET_CHAIN_ID) throw new Error("viem Arc Testnet chain metadata is inconsistent.");
export const arcTestnet = viemArcTestnet;
export const supportedCooketChains = [arcTestnet] as const;
export type CooketChain = (typeof supportedCooketChains)[number];

export function isSupportedCooketChainId(value: number): value is CooketChainId {
  return value === ARC_TESTNET_CHAIN_ID;
}

export function resolveCooketChain(value: string | number): CooketChain {
  const normalized = typeof value === "string" ? value.trim() : value;
  const chainId = typeof normalized === "number" ? normalized : /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  if (!Number.isInteger(chainId) || !isSupportedCooketChainId(chainId)) {
    throw new Error(`Unsupported Cooket chain ID: ${String(value)}`);
  }
  return arcTestnet;
}

export type ContractAddresses = {
  cooketFactory?: `0x${string}`;
	/** Test-only override; runtime curve resolution always uses factory.curveOf. */
	cooketCurve?: `0x${string}`;
  feeManager?: `0x${string}`;
  graduationManager?: `0x${string}`;
  permanentLPFeeVault?: `0x${string}`;
  permanentLPCustodianDeployer?: `0x${string}`;
  graduationSettlementExecutor?: `0x${string}`;
};

/**
 * Phase 0 deliberately ignores inherited or operator-supplied protocol
 * addresses. No Base-derived contract graph is valid on Arc Testnet yet.
 * Tests may assign entries explicitly to exercise pure migration-reference
 * readers; production builds always begin with an empty address set.
 */
export const contractAddresses: ContractAddresses = {};

export type TokenLaunched = { token: Address; curve: Address; creator: Address; protocolVersion: string; totalSupply: bigint; curveAllocation: bigint; lpAllocation: bigint; canonicalPool: Address };
export function encodeCreateToken(name: string, symbol: string, userSalt: Hex): Hex {
  return encodeFunctionData({ abi: cooketFactoryAbi, functionName: "createToken", args: [name, symbol, userSalt] });
}
export function parseTokenLaunchedReceipt(receipt: { status: string; logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] }, factory: Address): TokenLaunched {
  if (receipt.status !== "success") throw new Error("token creation transaction reverted");
  const receiptLogs = [...receipt.logs] as unknown as Parameters<typeof parseEventLogs>[0]["logs"];
  const logs = parseEventLogs({ abi: cooketFactoryAbi, eventName: "TokenLaunchedV3", logs: receiptLogs, strict: true }).filter((log) => getAddress(log.address) === getAddress(factory));
  if (logs.length !== 1) throw new Error("confirmed receipt did not contain exactly one TokenLaunched event");
  const args = logs[0].args;
  if (!args.token || !args.curve || !args.creator || args.totalSupply !== FIXED_TOKEN_SUPPLY || args.protocolVersion !== "endpoint-cp-v3") throw new Error("TokenLaunchedV3 event is malformed");
  return { token: getAddress(args.token), curve: getAddress(args.curve), creator: getAddress(args.creator), protocolVersion: args.protocolVersion, totalSupply: args.totalSupply, curveAllocation: args.curveAllocation, lpAllocation: args.lpAllocation, canonicalPool: getAddress(args.canonicalPool) };
}

export const erc20TradeAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export type BuyQuote = {
  reserveIn: bigint;
  curveCost: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
  acceptedGross?: bigint;
  netCurveInput?: bigint;
  tokensOut?: bigint;
  totalFee?: bigint;
  communityFee?: bigint;
  traderRewardsFee?: bigint;
};
export type SellQuote = {
  reserveOut: bigint;
  curveValue: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
  netSellerOutput?: bigint;
  totalFee?: bigint;
  communityFee?: bigint;
  traderRewardsFee?: bigint;
};
export type TradeReceipt = {
  side: "buy" | "sell";
  token: Address;
  trader: Address;
  tokenAmount: bigint;
  reserveAmount: bigint;
  curveValue: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
  totalFee?: bigint;
  communityFee?: bigint;
  traderRewardsFee?: bigint;
};

const BPS_SCALE = BigInt(10_000);

export function maxInputWithSlippage(amount: bigint, slippageBps: number): bigint {
  validateSlippage(slippageBps);
  return (amount * (BPS_SCALE + BigInt(slippageBps)) + BPS_SCALE - BigInt(1)) / BPS_SCALE;
}

export function minOutputWithSlippage(amount: bigint, slippageBps: number): bigint {
  validateSlippage(slippageBps);
  return amount * (BPS_SCALE - BigInt(slippageBps)) / BPS_SCALE;
}

function validateSlippage(slippageBps: number) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000) {
    throw new Error("Slippage must be between 0% and 50%.");
  }
}

export function encodeBuy(minTokensOut: bigint, deadline: bigint): Hex {
  return encodeFunctionData({ abi: cooketCurveAbi, functionName: "buy", args: [minTokensOut, deadline] });
}

export function encodeSell(tokensIn: bigint, minNativeUsdcOut: bigint, deadline: bigint): Hex {
  return encodeFunctionData({ abi: cooketCurveAbi, functionName: "sell", args: [tokensIn, minNativeUsdcOut, deadline] });
}

export const encodeApprove = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20TradeAbi, functionName: "approve", args: [spender, amount] });

export function parseTradeReceipt(
  receipt: { status: string; logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] },
  curve: Address,
  expectedSide: "buy" | "sell",
): TradeReceipt {
  if (receipt.status !== "success") throw new Error("trade transaction reverted");
  const eventName = expectedSide === "buy" ? "TokensBought" : "TokensSold";
  const receiptLogs = [...receipt.logs] as unknown as Parameters<typeof parseEventLogs>[0]["logs"];
  if (expectedSide === "buy") {
    const logs = parseEventLogs({ abi: cooketCurveAbi, eventName: "TokensBought", logs: receiptLogs, strict: true })
      .filter((log) => getAddress(log.address) === getAddress(curve));
    if (logs.length !== 1) throw new Error(`confirmed receipt did not contain exactly one ${eventName} event`);
    const args = logs[0].args;
    return {
      side: "buy",
      token: getAddress(args.token),
      trader: getAddress(args.buyer),
      tokenAmount: args.tokensOut,
      reserveAmount: args.acceptedGross,
      curveValue: args.netCurveInput,
      protocolFee: args.protocolFee,
      creatorFee: args.creatorFee,
      totalFee: args.totalFee,
      communityFee: args.communityFee,
      traderRewardsFee: args.traderRewardsFee,
    };
  }
  const logs = parseEventLogs({ abi: cooketCurveAbi, eventName: "TokensSold", logs: receiptLogs, strict: true })
    .filter((log) => getAddress(log.address) === getAddress(curve));
  if (logs.length !== 1) throw new Error(`confirmed receipt did not contain exactly one ${eventName} event`);
  const args = logs[0].args;
  return {
    side: "sell",
    token: getAddress(args.token),
    trader: getAddress(args.seller),
    tokenAmount: args.tokensIn,
    reserveAmount: args.grossCurveOutput,
    curveValue: args.netSellerOutput,
    protocolFee: args.protocolFee,
    creatorFee: args.creatorFee,
    totalFee: args.totalFee,
    communityFee: args.communityFee,
    traderRewardsFee: args.traderRewardsFee,
  };
}
