import {
  CURVE_ALLOCATION,
  contractAddresses,
  encodeApprove,
  encodeSell,
  erc20TradeAbi,
  feeManagerV3Abi,
  graduationManagerV3Abi,
  graduationSettlementExecutorV3Abi,
  permanentLPFeeVaultV3Abi,
  permanentLPCustodianV3Abi,
  minOutputWithSlippage,
  parseTokenLaunchedReceipt,
  parseTradeReceipt,
  cooketCurveAbi,
  cooketFactoryAbi,
  type BuyQuote,
  type SellQuote,
} from "@cooket/contracts-sdk";
import { createPublicClient, getAddress, http, keccak256, stringToBytes, type Address, type Hash, type Transaction, type TransactionReceipt, type WalletClient } from "viem";
import type { TradeRecovery } from "@/lib/transactions";
import { selectedCooketChain, selectedCooketChainName, selectedCooketRPCURL } from "@/lib/chain";
import { assertArcProtocolEconomicsReady } from "@/lib/arc-safety";

export { contractAddresses, erc20TradeAbi, feeManagerV3Abi, graduationManagerV3Abi, graduationSettlementExecutorV3Abi, permanentLPFeeVaultV3Abi, permanentLPCustodianV3Abi, cooketCurveAbi, cooketFactoryAbi };

export const publicClient = createPublicClient({
  chain: selectedCooketChain,
  transport: http(selectedCooketRPCURL),
});

export async function readTokenOnchain(token: Address) {
  if (!contractAddresses.cooketFactory) return null;
  return publicClient.readContract({ address: contractAddresses.cooketFactory, abi: cooketFactoryAbi, functionName: "tokenInfo", args: [token] });
}

export async function readCurveOnchain(token: Address) {
  const curve = await resolveCurveAddress(token);
  if (!curve) return null;
  return publicClient.readContract({ address: curve, abi: cooketCurveAbi, functionName: "token" });
}

export type BrowserWalletClient = WalletClient;

export async function assertActiveWalletClient(client: BrowserWalletClient, expectedAccount: Address) {
  const configuredAccount = client.account?.address;
  if (!configuredAccount || getAddress(configuredAccount) !== getAddress(expectedAccount)) throw new Error("The wallet client signer does not match the active address shown by Cooket.");
  const [chainId, addresses] = await Promise.all([client.getChainId(), client.getAddresses()]);
  if (chainId !== selectedCooketChain.id) throw new Error(`The active signer is on chain ${chainId}; switch to ${selectedCooketChainName} (${selectedCooketChain.id}).`);
  if (!addresses[0] || getAddress(addresses[0]) !== getAddress(expectedAccount)) throw new Error("The wallet disconnected or changed accounts before submission. Review the transaction again.");
}

export async function submitCreateToken(client: BrowserWalletClient, creator: Address, name: string, symbol: string, userSalt: `0x${string}` | CurveInitialization | { startingPrice: bigint; slope: bigint; graduationThreshold: bigint }) {
  assertArcProtocolEconomicsReady();
  const factory = contractAddresses.cooketFactory;
  if (!factory) throw new Error("Factory address is not configured.");
  const salt = typeof userSalt === "string" ? userSalt : ("userSalt" in userSalt ? userSalt.userSalt : keccak256(stringToBytes(`${name}-${symbol}-${Date.now()}`)));
  const args = [name, symbol, salt] as const;
  const { request } = await publicClient.simulateContract({ address: factory, abi: cooketFactoryAbi, functionName: "createToken", args, account: creator });
  await assertActiveWalletClient(client, creator);
  return client.writeContract(request);
}

export async function confirmCreatedToken(hash: Hash) {
  const factory = contractAddresses.cooketFactory;
  if (!factory) throw new Error("Factory address is not configured.");
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  return { receipt, created: parseTokenLaunchedReceipt(receipt, factory) };
}

export type CurveTradeState = {
  curveSupply: bigint;
  soldSupply: bigint;
  reserveBalance: bigint;
  graduationThreshold: bigint;
  lifecycle: number;
  nativeBalance: bigint;
  tokenBalance: bigint;
  allowance: bigint;
  decimals: number;
};

export async function readTradeState(token: Address, account?: Address): Promise<CurveTradeState> {
  const curveAddress = await resolveCurveAddress(token);
  if (!curveAddress) throw new Error("Curve address is not configured for this token.");
  const [soldSupply, activeEthReserve, graduated, nativeBalance, tokenBalance, allowance, decimals] = await Promise.all([
    publicClient.readContract({ address: curveAddress, abi: cooketCurveAbi, functionName: "soldSupply" }),
    publicClient.readContract({ address: curveAddress, abi: cooketCurveAbi, functionName: "activeEthReserve" }),
    publicClient.readContract({ address: curveAddress, abi: cooketCurveAbi, functionName: "graduated" }),
    account ? publicClient.getBalance({ address: account }) : Promise.resolve(BigInt(0)),
    account ? publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "balanceOf", args: [account] }) : Promise.resolve(BigInt(0)),
    account ? publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "allowance", args: [account, curveAddress] }) : Promise.resolve(BigInt(0)),
    publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "decimals" }),
  ]);
  return {
    curveSupply: CURVE_ALLOCATION,
    soldSupply,
    reserveBalance: activeEthReserve,
    graduationThreshold: CURVE_ALLOCATION,
    lifecycle: graduated ? 2 : 0,
    nativeBalance,
    tokenBalance,
    allowance,
    decimals,
  };
}

export async function readCurveAvailability(token: Address) {
  try {
    const chainId = await publicClient.getChainId();
    if (chainId !== selectedCooketChain.id) throw new Error(`RPC returned chain ID ${chainId}; expected ${selectedCooketChainName} (${selectedCooketChain.id}).`);
    const factoryAddress = contractAddresses.cooketFactory;
    if (!factoryAddress) throw new Error("NEXT_PUBLIC_COOKET_FACTORY_V3_ADDRESS is missing or invalid.");
    const factoryCode = await publicClient.getBytecode({ address: factoryAddress });
    if (!factoryCode || factoryCode === "0x") throw new Error(`No factory bytecode exists at ${factoryAddress} on ${selectedCooketChainName}.`);
    const curveAddress = await resolveCurveAddress(token);
    if (!curveAddress) return null;
    const curveCode = await publicClient.getBytecode({ address: curveAddress });
    if (!curveCode || curveCode === "0x") throw new Error(`Factory resolved ${curveAddress}, but no curve bytecode exists there on ${selectedCooketChainName}.`);
    const [factory, curveToken, creator, graduated] = await Promise.all([
      publicClient.readContract({ address: curveAddress, abi: cooketCurveAbi, functionName: "factory" }),
      publicClient.readContract({ address: curveAddress, abi: cooketCurveAbi, functionName: "token" }),
      publicClient.readContract({ address: curveAddress, abi: cooketCurveAbi, functionName: "creator" }),
      publicClient.readContract({ address: curveAddress, abi: cooketCurveAbi, functionName: "graduated" }),
    ]);
    if (getAddress(factory) !== getAddress(factoryAddress)) throw new Error(`Curve factory() returned ${factory}; expected ${factoryAddress}. The ABI or deployment is incompatible.`);
    if (getAddress(curveToken) !== getAddress(token)) throw new Error(`Curve token() returned ${curveToken}; expected ${token}. The registry entry is inconsistent.`);
    return { address: curveAddress, state: { graduated, creator } };
  } catch (error) {
    if (isCurveNotFound(error)) return null;
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Arc Testnet curve read failed", { chainId: selectedCooketChain.id, factory: contractAddresses.cooketFactory, token, detail });
    throw new Error(`Arc Testnet curve read failed for token ${token}: ${detail}`, { cause: error });
  }
}

export type CurveInitialization = { userSalt: `0x${string}` };
export function configuredCurveInitialization(): CurveInitialization { return { userSalt: keccak256(stringToBytes(`${Date.now()}-${Math.random()}`)) }; }

export type BudgetBuyQuote = BuyQuote & { tokenAmount: bigint; maxReserveIn: bigint; slippageBps: number; deadline: bigint };
export type ProtectedSellQuote = SellQuote & { tokenAmount: bigint; minReserveOut: bigint; slippageBps: number; deadline: bigint };

export async function quoteBuyByBudget(token: Address, budget: bigint, state: Pick<CurveTradeState, "soldSupply" | "graduationThreshold">, slippageBps: number): Promise<BudgetBuyQuote> {
  if (budget <= BigInt(0)) throw new Error("Enter a native USDC amount greater than zero.");
  const quote = await readBuyQuote(token, budget);
  if (quote.tokensOut === BigInt(0)) throw new Error("The native USDC amount is too small for the minimum trade.");
  return { reserveIn: quote.acceptedGross ?? budget, curveCost: quote.netCurveInput ?? BigInt(0), protocolFee: quote.protocolFee, creatorFee: quote.creatorFee, acceptedGross: quote.acceptedGross, netCurveInput: quote.netCurveInput, tokensOut: quote.tokensOut, tokenAmount: quote.tokensOut ?? BigInt(0), maxReserveIn: budget, slippageBps, deadline: transactionDeadline() };
}

export async function quoteSellAmount(token: Address, tokenAmount: bigint, slippageBps: number): Promise<ProtectedSellQuote> {
  if (tokenAmount <= BigInt(0)) throw new Error("Enter a token amount greater than zero.");
  const quote = await readSellQuote(token, tokenAmount);
  return { ...quote, tokenAmount, minReserveOut: minOutputWithSlippage(quote.reserveOut, slippageBps), slippageBps, deadline: transactionDeadline() };
}

export async function submitBuy(client: BrowserWalletClient, account: Address, token: Address, quote: BudgetBuyQuote, assertReady: () => void = () => undefined): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const deadline = quote.deadline;
  assertBuyQuoteFresh(quote);
  assertReady();
  const nativeBalance = await publicClient.getBalance({ address: account });
  if (nativeBalance < quote.maxReserveIn) throw new Error("The connected wallet has insufficient native USDC for this buy.");
  const { request } = await publicClient.simulateContract({
    address: curve,
    abi: cooketCurveAbi,
    functionName: "buy",
    args: [minOutputWithSlippage(quote.tokenAmount, quote.slippageBps), deadline],
    account,
    value: quote.maxReserveIn,
  });
  assertBuyQuoteFresh(quote);
  assertReady();
  await assertActiveWalletClient(client, account);
  return client.writeContract(request);
}

export async function submitSell(
  client: BrowserWalletClient,
  account: Address,
  token: Address,
  quote: ProtectedSellQuote,
  callbacks: {
    onApprovalRequested: () => void;
    onApprovalSubmitted: (hash: Hash) => void;
    onApprovalConfirmed: (hash: Hash) => void;
    onSellPreparing?: () => void;
    onSellRequested: () => void;
  },
  assertReady: () => void = () => undefined,
): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  assertSellDeadline(quote);
  assertReady();
  let state = await readBrowserSellState(token, account, curve);
  if (state.tokenBalance < quote.tokenAmount) throw new Error("The connected wallet has insufficient token balance for this sell.");

  if (state.allowance < quote.tokenAmount) {
    assertSellDeadline(quote);
    assertReady();
    callbacks.onApprovalRequested();
    const { request: approvalRequest } = await publicClient.simulateContract({ address: token, abi: erc20TradeAbi, functionName: "approve", args: [curve, quote.tokenAmount], account });
    await assertActiveWalletClient(client, account);
    const approvalHash = await client.writeContract(approvalRequest);
    callbacks.onApprovalSubmitted(approvalHash);
    const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash, confirmations: 1, timeout: 120_000 });
    if (approvalReceipt.status !== "success") throw new Error(`The token approval transaction reverted on ${selectedCooketChainName}.`);
    callbacks.onApprovalConfirmed(approvalHash);

    // The approval changes the exact state this flow depends on. Never carry
    // the pre-approval allowance snapshot into sell preparation.
    assertSellDeadline(quote);
    assertReady();
    state = await waitForBrowserAllowance(token, account, curve, quote.tokenAmount);
  }

  if (state.allowance < quote.tokenAmount) throw new Error("The confirmed token approval is still insufficient for this sell.");
  if (state.tokenBalance < quote.tokenAmount) throw new Error("The connected wallet has insufficient token balance for this sell.");
  assertSellDeadline(quote);
  assertReady();
  callbacks.onSellPreparing?.();
  const { request } = await publicClient.simulateContract({ address: curve, abi: cooketCurveAbi, functionName: "sell", args: [quote.tokenAmount, quote.minReserveOut, quote.deadline], account });
  assertSellDeadline(quote);
  assertReady();
  callbacks.onSellRequested();
  await assertActiveWalletClient(client, account);
  return client.writeContract(request);
}

async function readBrowserSellState(token: Address, account: Address, curve: Address) {
  const [allowance, tokenBalance] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "allowance", args: [account, curve] }),
    publicClient.readContract({ address: token, abi: erc20TradeAbi, functionName: "balanceOf", args: [account] }),
  ]);
  return { allowance, tokenBalance };
}

const browserAllowancePollDelays = [0, 250, 500, 1000, 1500] as const;

async function waitForBrowserAllowance(token: Address, account: Address, curve: Address, required: bigint) {
  let lastError: unknown;
  for (let attempt = 0; attempt < browserAllowancePollDelays.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, browserAllowancePollDelays[attempt]));
    try {
      const state = await readBrowserSellState(token, account, curve);
      if (state.allowance >= required) return state;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw new Error(`The confirmed approval could not be re-read for the active token and curve: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  throw new Error("The confirmed token approval is still insufficient for this sell.");
}

function assertSellDeadline(quote: ProtectedSellQuote) {
  if (BigInt(Math.floor(Date.now() / 1000)) >= quote.deadline) {
    throw new Error("This quote expired during wallet approval. Request a fresh quote before selling.");
  }
}

export function assertBuyQuoteFresh(quote: Pick<BudgetBuyQuote, "deadline">) {
  if (BigInt(Math.floor(Date.now() / 1000)) >= quote.deadline) throw new Error("This quote expired. Request a fresh quote before buying.");
}

export type TradeConfirmation = {
  status: "confirmed" | "reverted" | "replaced" | "pending";
  hash: Hash;
  replacementReason?: "cancelled" | "replaced" | "repriced";
  recovery?: TradeRecovery;
};

export function buildSellCalls(token: Address, curve: Address, quote: ProtectedSellQuote, allowance: bigint, deadline: bigint) {
  const calls: Array<{ to: Address; data: `0x${string}` }> = [];
  if (allowance < quote.tokenAmount) calls.push({ to: token, data: encodeApprove(curve, quote.tokenAmount) });
  calls.push({ to: curve, data: encodeSell(quote.tokenAmount, quote.minReserveOut, deadline) });
  return calls;
}

export async function confirmTrade(hash: Hash, side: "buy" | "sell", token: Address, trader: Address, recovery?: TradeRecovery): Promise<TradeConfirmation> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  let replacementReason: TradeConfirmation["replacementReason"];
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 120_000,
      onReplaced: (replacement) => { replacementReason = replacement.reason; },
    });
    return resolveTradeReceipt(receipt, curve, side, token, trader, replacementReason);
  } catch (error) {
    if (!isReceiptTimeout(error)) throw error;
    return checkTrade(hash, side, token, trader, recovery);
  }
}

export async function captureTradeRecovery(hash: Hash): Promise<TradeRecovery | undefined> {
  try {
    const [transaction, blockNumber] = await Promise.all([
      publicClient.getTransaction({ hash }),
      publicClient.getBlockNumber(),
    ]);
    return {
      sender: transaction.from,
      nonce: transaction.nonce,
      to: transaction.to ?? undefined,
      value: transaction.value.toString(),
      input: transaction.input,
      nextScanBlock: (transaction.blockNumber ?? blockNumber).toString(),
    };
  } catch {
    return undefined;
  }
}

export async function checkTrade(hash: Hash, side: "buy" | "sell", token: Address, trader: Address, recovery?: TradeRecovery): Promise<TradeConfirmation> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const result = await recoverTransactionReceipt(publicClient as unknown as TradeRecoveryClient, hash, recovery);
  if (result.kind === "receipt") {
    const receipt = result.receipt;
    return resolveTradeReceipt(receipt, curve, side, token, trader);
  }
  if (result.kind === "replacement") return { status: "replaced", hash: result.receipt.transactionHash, replacementReason: result.reason };
  return { status: "pending", hash, recovery: result.recovery };
}

async function resolveTradeReceipt(receipt: TransactionReceipt, curve: Address, side: "buy" | "sell", token: Address, trader: Address, replacementReason?: TradeConfirmation["replacementReason"]): Promise<TradeConfirmation> {
  if (replacementReason) return { status: "replaced", hash: receipt.transactionHash, replacementReason };
  if (receipt.status === "reverted") return { status: "reverted", hash: receipt.transactionHash };
  const transaction = await publicClient.getTransaction({ hash: receipt.transactionHash });
  if (getAddress(transaction.from) !== getAddress(trader)) throw new Error("Confirmed trade sender does not match the connected wallet.");
  if (!transaction.to || getAddress(transaction.to) !== getAddress(curve)) throw new Error("Confirmed trade target does not match the deployed curve.");
  let trade;
  try {
    trade = parseTradeReceipt(receipt, curve, side);
  } catch (error) {
    throw error;
  }
  if (getAddress(trade.token) !== getAddress(token) || getAddress(trade.trader) !== getAddress(trader)) {
    throw new Error("Confirmed trade does not match the connected wallet and token.");
  }
  return { status: "confirmed", hash: receipt.transactionHash, replacementReason };
}

type RecoveryTransaction = Pick<Transaction, "from" | "nonce" | "to" | "value" | "input" | "hash">;
type TradeRecoveryClient = {
  getTransactionReceipt: (parameters: { hash: Hash }) => Promise<TransactionReceipt>;
  getTransaction: (parameters: { hash: Hash }) => Promise<RecoveryTransaction>;
  getBlockNumber: () => Promise<bigint>;
  getTransactionCount: (parameters: { address: Address; blockTag: "latest" }) => Promise<number>;
  getBlock: (parameters: { blockNumber: bigint; includeTransactions: true }) => Promise<{ transactions: readonly (Hash | RecoveryTransaction)[] }>;
};

type RecoveryResult =
  | { kind: "receipt"; receipt: TransactionReceipt }
  | { kind: "replacement"; receipt: TransactionReceipt; reason: "cancelled" | "replaced" | "repriced" }
  | { kind: "pending"; recovery?: TradeRecovery };

const REPLACEMENT_SCAN_BATCH = BigInt(128);

export async function recoverTransactionReceipt(client: TradeRecoveryClient, hash: Hash, storedRecovery?: TradeRecovery): Promise<RecoveryResult> {
  try {
    return { kind: "receipt", receipt: await client.getTransactionReceipt({ hash }) };
  } catch (error) {
    if (!isReceiptNotFound(error)) throw error;
  }

  let recovery = storedRecovery;
  if (!recovery) {
    try {
      const [transaction, blockNumber] = await Promise.all([
        client.getTransaction({ hash }),
        client.getBlockNumber(),
      ]);
      recovery = {
        sender: transaction.from,
        nonce: transaction.nonce,
        to: transaction.to ?? undefined,
        value: transaction.value.toString(),
        input: transaction.input,
        nextScanBlock: blockNumber.toString(),
      };
    } catch {
      return { kind: "pending" };
    }
  }

  const consumedNonce = await client.getTransactionCount({ address: recovery.sender, blockTag: "latest" });
  if (consumedNonce <= recovery.nonce) return { kind: "pending", recovery };

  const latestBlock = await client.getBlockNumber();
  const firstBlock = BigInt(recovery.nextScanBlock);
  const lastBlock = firstBlock + REPLACEMENT_SCAN_BATCH - BigInt(1) < latestBlock
    ? firstBlock + REPLACEMENT_SCAN_BATCH - BigInt(1)
    : latestBlock;

  for (let blockNumber = firstBlock; blockNumber <= lastBlock; blockNumber += BigInt(1)) {
    const block = await client.getBlock({ blockNumber, includeTransactions: true });
    const transaction = block.transactions.find((candidate): candidate is RecoveryTransaction => typeof candidate !== "string" && getAddress(candidate.from) === getAddress(recovery.sender) && candidate.nonce === recovery.nonce);
    if (!transaction) continue;
    const receipt = await client.getTransactionReceipt({ hash: transaction.hash });
    if (transaction.hash.toLowerCase() === hash.toLowerCase()) return { kind: "receipt", receipt };
    return { kind: "replacement", receipt, reason: replacementReason(recovery, transaction) };
  }

  if (lastBlock < latestBlock) return { kind: "pending", recovery: { ...recovery, nextScanBlock: (lastBlock + BigInt(1)).toString() } };
  throw new Error("The original nonce was consumed, but replacement provenance was unavailable. Confirmation remains unknown.");
}

function replacementReason(original: TradeRecovery, replacement: RecoveryTransaction): "cancelled" | "replaced" | "repriced" {
  if (replacement.to && getAddress(replacement.from) === getAddress(replacement.to) && replacement.value === BigInt(0)) return "cancelled";
  if ((replacement.to?.toLowerCase() ?? "") === (original.to?.toLowerCase() ?? "") && replacement.value.toString() === original.value && replacement.input.toLowerCase() === original.input.toLowerCase()) return "repriced";
  return "replaced";
}

function isReceiptNotFound(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /TransactionReceiptNotFound|transaction receipt.*(?:not|could not) be found/i.test(message);
}

function isReceiptTimeout(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /WaitForTransactionReceiptTimeout|timed? out|timeout/i.test(message);
}

async function readBuyQuote(token: Address, tokenAmount: bigint): Promise<BuyQuote> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const quote = await publicClient.readContract({ address: curve, abi: cooketCurveAbi, functionName: "quoteBuy", args: [tokenAmount] });
  return { reserveIn: quote.acceptedGross, curveCost: quote.netCurveInput, protocolFee: quote.protocolFee, creatorFee: quote.creatorFee, acceptedGross: quote.acceptedGross, netCurveInput: quote.netCurveInput, tokensOut: quote.tokensOut };
}

async function readSellQuote(token: Address, tokenAmount: bigint): Promise<SellQuote> {
  const curve = await resolveCurveAddress(token);
  if (!curve) throw new Error("Curve address is not configured for this token.");
  const quote = await publicClient.readContract({ address: curve, abi: cooketCurveAbi, functionName: "quoteSell", args: [tokenAmount] });
  return { reserveOut: quote.netSellerOutput, curveValue: quote.grossCurveOutput, protocolFee: quote.protocolFee, creatorFee: quote.creatorFee, netSellerOutput: quote.netSellerOutput };
}

export async function resolveCurveAddress(token: Address): Promise<Address | undefined> {
  if (contractAddresses.cooketCurve) return contractAddresses.cooketCurve;
  if (!contractAddresses.cooketFactory) return undefined;
  const curve = await publicClient.readContract({ address: contractAddresses.cooketFactory, abi: cooketFactoryAbi, functionName: "curveOf", args: [token] });
  if (!curve || /^0x0{40}$/i.test(curve)) return undefined;
  return curve;
}

function transactionDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 300);
}

function isCurveNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("0xf3295903") || message.includes("CurveNotFound");
}
