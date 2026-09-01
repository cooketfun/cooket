import { encodeFunctionData, getAddress, parseEventLogs, type Address, type Hex } from "viem";
import { arcTestnet as viemArcTestnet } from "viem/chains";

export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_NATIVE_CURRENCY_DECIMALS = 18 as const;
export const ARC_USDC_TOKEN_DECIMALS = 6 as const;
/** Historical test/reference constants. They are not supported runtime chains. */
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_MAINNET_CHAIN_ID = 8453 as const;
export type CooketChainId = typeof ARC_TESTNET_CHAIN_ID;
export const FIXED_TOKEN_SUPPLY = BigInt("1000000000000000000000000000");
export const CURVE_ALLOCATION = BigInt("800000000000000000000000000");
/** Legacy Base ETH economic constant, retained for contract-reference tests only. */
export const EXACT_GRADUATION_GROSS = BigInt("3030303030303030303");

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

export const cooketFactoryAbi = [
  { type: "function", name: "createToken", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "userSalt", type: "bytes32" }], outputs: [{ name: "token", type: "address" }, { name: "curve", type: "address" }] },
  { type: "function", name: "curveOf", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isToken", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "tokenInfo", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "creator", type: "address" }, { name: "curve", type: "address" }] },
  { type: "function", name: "tokensByCreator", stateMutability: "view", inputs: [{ name: "creator", type: "address" }], outputs: [{ type: "address[]" }] },
  { type: "event", name: "TokenLaunchedV3", anonymous: false, inputs: [{ name: "creator", type: "address", indexed: true }, { name: "token", type: "address", indexed: true }, { name: "curve", type: "address", indexed: true }, { name: "protocolVersion", type: "string", indexed: false }, { name: "totalSupply", type: "uint256", indexed: false }, { name: "curveAllocation", type: "uint256", indexed: false }, { name: "lpAllocation", type: "uint256", indexed: false }, { name: "initialCreatorPayout", type: "address", indexed: false }, { name: "canonicalPool", type: "address", indexed: false }, { name: "launchSeed", type: "bytes32", indexed: false }, { name: "candidateSalt", type: "bytes32", indexed: false }, { name: "attemptIndex", type: "uint16", indexed: false }] },
] as const;

export const feeManagerV3Abi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protocolVersionHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

export const graduationManagerV3Abi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "uniswapV3Factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "permanentLPFeeVault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "permanentLPCustodianDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "nonfungiblePositionManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "settlementExecutor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const permanentLPFeeVaultV3Abi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "graduationManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "permanentLPCustodianDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const permanentLPCustodianV3Abi = [
  { type: "function", name: "launchToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "positionRegistered", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "boundTokenId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeVault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "nonfungiblePositionManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const graduationSettlementExecutorV3Abi = [
  { type: "function", name: "graduationManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "nonfungiblePositionManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

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

const cooketCurveBuyQuoteComponents = [
  { name: "submittedGross", type: "uint256" },
  { name: "acceptedGross", type: "uint256" },
  { name: "totalFee", type: "uint256" },
  { name: "creatorFee", type: "uint256" },
  { name: "protocolFee", type: "uint256" },
  { name: "communityFee", type: "uint256" },
  { name: "traderRewardsFee", type: "uint256" },
  { name: "netCurveInput", type: "uint256" },
  { name: "refund", type: "uint256" },
  { name: "tokensOut", type: "uint256" },
  { name: "reachesGraduation", type: "bool" },
] as const;

const cooketCurveSellQuoteComponents = [
  { name: "tokensIn", type: "uint256" },
  { name: "grossCurveOutput", type: "uint256" },
  { name: "totalFee", type: "uint256" },
  { name: "creatorFee", type: "uint256" },
  { name: "protocolFee", type: "uint256" },
  { name: "communityFee", type: "uint256" },
  { name: "traderRewardsFee", type: "uint256" },
  { name: "netSellerOutput", type: "uint256" },
] as const;

export const cooketCurveAbi = [
  { type: "error", name: "AlreadyGraduated", inputs: [] },
  { type: "error", name: "DeadlineExpired", inputs: [] },
  { type: "error", name: "DustTrade", inputs: [] },
  { type: "error", name: "GraduationAccountingMismatch", inputs: [] },
  { type: "error", name: "GraduationManagerInvalid", inputs: [] },
  { type: "error", name: "InsufficientCurveInventory", inputs: [] },
  { type: "error", name: "InsufficientReserve", inputs: [] },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "InvalidFactory", inputs: [] },
  { type: "error", name: "InvalidFeeManager", inputs: [] },
  { type: "error", name: "InvalidRecipient", inputs: [] },
  { type: "error", name: "NativeTransferFailed", inputs: [] },
  { type: "error", name: "SlippageExceeded", inputs: [] },
  { type: "error", name: "TokenInvalid", inputs: [] },
  { type: "error", name: "TokenTransferFailed", inputs: [] },
  { type: "error", name: "TradingClosed", inputs: [] },
  { type: "error", name: "UnexpectedEther", inputs: [] },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "soldSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "activeEthReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "feePolicyHash", stateMutability: "pure", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "quoteBuy", stateMutability: "view", inputs: [{ name: "grossInput", type: "uint256" }], outputs: [{ name: "quote", type: "tuple", components: cooketCurveBuyQuoteComponents }] },
  { type: "function", name: "quoteSell", stateMutability: "view", inputs: [{ name: "tokensIn", type: "uint256" }], outputs: [{ name: "quote", type: "tuple", components: cooketCurveSellQuoteComponents }] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "minTokensOut", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "quote", type: "tuple", components: cooketCurveBuyQuoteComponents }] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ name: "tokensIn", type: "uint256" }, { name: "minEthOut", type: "uint256" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "quote", type: "tuple", components: cooketCurveSellQuoteComponents }] },
  { type: "event", name: "TokensBought", anonymous: false, inputs: [{ name: "token", type: "address", indexed: true }, { name: "buyer", type: "address", indexed: true }, { name: "submittedGross", type: "uint256", indexed: false }, { name: "acceptedGross", type: "uint256", indexed: false }, { name: "netCurveInput", type: "uint256", indexed: false }, { name: "tokensOut", type: "uint256", indexed: false }, { name: "totalFee", type: "uint256", indexed: false }, { name: "creatorFee", type: "uint256", indexed: false }, { name: "protocolFee", type: "uint256", indexed: false }, { name: "communityFee", type: "uint256", indexed: false }, { name: "traderRewardsFee", type: "uint256", indexed: false }, { name: "refund", type: "uint256", indexed: false }] },
  { type: "event", name: "TokensSold", anonymous: false, inputs: [{ name: "token", type: "address", indexed: true }, { name: "seller", type: "address", indexed: true }, { name: "tokensIn", type: "uint256", indexed: false }, { name: "grossCurveOutput", type: "uint256", indexed: false }, { name: "netSellerOutput", type: "uint256", indexed: false }, { name: "totalFee", type: "uint256", indexed: false }, { name: "creatorFee", type: "uint256", indexed: false }, { name: "protocolFee", type: "uint256", indexed: false }, { name: "communityFee", type: "uint256", indexed: false }, { name: "traderRewardsFee", type: "uint256", indexed: false }] },
] as const;

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

export function encodeSell(tokensIn: bigint, minEthOut: bigint, deadline: bigint): Hex {
  return encodeFunctionData({ abi: cooketCurveAbi, functionName: "sell", args: [tokensIn, minEthOut, deadline] });
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
