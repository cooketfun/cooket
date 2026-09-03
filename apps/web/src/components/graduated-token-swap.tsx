"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address, type Hash, type WalletClient } from "viem";
import { ARC_CANONICAL_USDC, ARC_USDC_TOKEN_DECIMALS } from "@cooket/contracts-sdk";
import { assertActiveWalletClient, publicClient } from "@/lib/contracts";
import { selectedCooketChain, selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";
import { TransactionModal } from "@/components/transaction-modal";
import { closedTransactionModal, transactionModalReducer, type TransactionModalPhase } from "@/lib/transaction-modal";
import { tradeInvalidationKeys } from "@/components/token-trading";
import { TradeAmountPresets } from "@/components/trade-amount-presets";
import { activeWalletStatusMessage, useActiveWallet } from "@/providers/active-wallet-provider";
import { approvalCall, buildGraduatedSwapTransaction, configuredUniswapV3, GraduatedSwapRpcError, GraduatedSwapRpcTimeoutError, orchestrateGraduatedSwap, quoteGraduatedSwap, quoteIsFresh, readGraduatedAllowance, readGraduatedSwapState, readGraduatedTokenDecimals, validateCanonicalPool, type GraduatedQuote, type GraduatedSwapState, type GraduatedSwapTransaction } from "@/lib/uniswap-v3";
import { assertArcProtocolEconomicsReady } from "@/lib/arc-safety";

type State = GraduatedSwapState;
type SwapStatus = "idle" | "quoting" | "awaiting_approval" | "approval_confirming" | "approval_confirmed" | "refreshing_state" | "awaiting_wallet" | "submitted" | "confirming" | "confirmed" | "rejected" | "error";

export function GraduatedTokenSwap({ tokenAddress, canonicalPoolAddress, symbol }: { tokenAddress: Address; canonicalPoolAddress?: Address; symbol: string }) {
  const activeWallet = useActiveWallet();
  const { connected, canTransact, status: walletStatus, activeAddress: wallet, activeChainId: chainId, walletClient } = activeWallet;
  const queryClient = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.50");
  const [quote, setQuote] = useState<GraduatedQuote>();
  const [status, setStatus] = useState<SwapStatus>("idle");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash>();
  const [pending, setPending] = useState(false);
  const [modal, dispatchModal] = useReducer(transactionModalReducer, closedTransactionModal);
  const busy = useRef(false);
  const executionContext = useRef({ wallet, chainId });
  useEffect(() => { executionContext.current = { wallet, chainId }; }, [chainId, wallet]);
  useEffect(() => {
    if (!modal.open) return;
    const phase = swapModalPhase(status, side);
    if (phase) dispatchModal({ type: "progress", phase });
  }, [modal.open, side, status]);
  const poolQuery = useQuery({ queryKey: ["graduated-pool", tokenAddress, canonicalPoolAddress], queryFn: () => validateCanonicalPool(canonicalPoolAddress!, tokenAddress), enabled: Boolean(canonicalPoolAddress && configuredUniswapV3()), staleTime: 30_000 });
  const decimalsQuery = useQuery({ queryKey: ["graduated-token-decimals", tokenAddress], queryFn: () => readGraduatedTokenDecimals(tokenAddress), staleTime: Infinity, gcTime: Infinity });
  const stateQuery = useQuery({ queryKey: ["graduated-swap-state", tokenAddress, wallet, poolQuery.data?.router, side], queryFn: () => readGraduatedSwapState(tokenAddress, wallet!, poolQuery.data!.router, side), enabled: Boolean(wallet && poolQuery.data), refetchInterval: 15_000 });
  const tokenDecimals = decimalsQuery.data;
  const config = configuredUniswapV3();
  const guard = !config ? `Swap configuration unavailable: verified ${selectedCooketChainName} QuoterV2, SwapRouter, and factory addresses are required.` : !canonicalPoolAddress ? "No indexed canonical graduation pool is available for this token." : chainId !== undefined && chainId !== selectedCooketChainId ? `Switch the active wallet to ${selectedCooketChainName} (${selectedCooketChainId}).` : !connected || !wallet || !walletClient || !canTransact ? activeWalletStatusMessage(walletStatus) : poolQuery.isError ? poolQuery.error.message : null;

  const requestQuote = useCallback(async () => {
    if (guard || !poolQuery.data || !wallet) return;
    try {
      setStatus("quoting");
      setError("");
      const decimals = side === "buy" ? ARC_USDC_TOKEN_DECIMALS : tokenDecimals;
      if (decimals === undefined) throw new Error("Token decimals are unavailable.");
      const bps = Math.round(Number(slippage) * 100);
      const parsed = validateSwapInput(amount, decimals, side, stateQuery.data, symbol);
      setQuote(await quoteGraduatedSwap(poolQuery.data, side, parsed, bps, wallet));
      setStatus("idle");
    } catch (reason) {
      setStatus("error");
      setError(errorMessage(reason));
    }
  }, [amount, guard, poolQuery.data, side, slippage, stateQuery.data, symbol, tokenDecimals, wallet]);

  useEffect(() => {
    if (guard || !amount || busy.current) return;
    const id = window.setTimeout(() => void requestQuote(), 500);
    return () => window.clearTimeout(id);
  }, [amount, guard, requestQuote, side, slippage]);

  const changeAmount = (value: string) => {
    setAmount(value);
    setQuote(undefined);
  };

  const submit = async () => {
    if (busy.current || !quote || !poolQuery.data || !wallet || !stateQuery.data) return;
    const assertContext = () => {
      const current = executionContext.current;
      if (current.wallet?.toLowerCase() !== wallet.toLowerCase() || current.chainId !== chainId || !quoteIsFresh(quote, wallet, poolQuery.data!.pool, chainId ?? 0)) throw new Error("This quote is stale or the wallet/network changed. Request a fresh quote.");
    };
    try { assertContext(); } catch { return rejectStaleQuote(setQuote, setStatus, setError); }
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (!walletClient) throw new Error("The connected browser wallet is unavailable.");
      const send = walletTransport(walletClient, wallet);
      const swapHash = await orchestrateGraduatedSwap({
        side,
        amountIn: quote.amountIn,
        initialState: stateQuery.data,
        readAllowance: () => { setStatus("refreshing_state"); return readGraduatedAllowance(tokenAddress, wallet, poolQuery.data!.router, side); },
        approve: async () => { await approveExactly(send, side === "buy" ? ARC_CANONICAL_USDC : tokenAddress, poolQuery.data!.router, quote.amountIn, wallet, setHash, setStatus); },
        assertContext,
        buildTransaction: () => buildGraduatedSwapTransaction(poolQuery.data!, quote, wallet),
        send: (transaction) => { setHash(undefined); setStatus("awaiting_wallet"); return send(transaction, "Swap"); },
      });
      setHash(swapHash);
      setStatus("submitted");
      setStatus("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash, confirmations: 1, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`The swap reverted on ${selectedCooketChainName}.`);
      setStatus("confirmed");
      await Promise.all([["graduated-swap-state", tokenAddress], ...tradeInvalidationKeys(tokenAddress)].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    } catch (reason) {
      setStatus(/reject|denied|cancelled/i.test(errorMessage(reason)) ? "rejected" : "error");
      setError(swapErrorMessage(reason));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return <section className="terminal-panel p-5" aria-label="Graduated token swap">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-white">Swap</h2><span className="badge-violet">Graduated · V3</span></div>
    <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Swap side">
      <button className={side === "buy" ? "button-primary" : "button-secondary"} type="button" onClick={() => { setSide("buy"); setQuote(undefined); }} disabled={pending}>Buy {symbol}</button>
      <button className={side === "sell" ? "button-primary" : "button-secondary"} type="button" onClick={() => { setSide("sell"); setQuote(undefined); }} disabled={pending}>Sell {symbol}</button>
    </div>
    {guard ? <p className="status-box status-warning mt-4 text-sm">{guard}</p> : <>
      <label className="mt-5 block text-xs text-zinc-500">Pay <span className="float-right">{side === "buy" ? "ERC20 USDC" : symbol}</span><input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-white" aria-label={side === "buy" ? "ERC20 USDC amount" : `${symbol} amount`} inputMode="decimal" value={amount} onChange={(event) => changeAmount(event.target.value)} placeholder="0.0" /></label>
      <TradeAmountPresets side={side} buyBalance={stateQuery.data?.usdc} buyDecimals={ARC_USDC_TOKEN_DECIMALS} buyIsNative={false} tokenBalance={stateQuery.data?.token} tokenDecimals={tokenDecimals ?? 18} disabled={pending || Boolean(guard)} onSelect={changeAmount} />
      <p className="mt-1 text-xs text-zinc-600">Balance {stateQuery.data ? (side === "buy" ? formatUnits(stateQuery.data.usdc, ARC_USDC_TOKEN_DECIMALS) : formatUnits(stateQuery.data.token, tokenDecimals ?? 18)) : "…"}</p>
      <label className="mt-4 block text-xs text-zinc-500">Slippage (%)<input className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-white" inputMode="decimal" value={slippage} onChange={(event) => { setSlippage(event.target.value); setQuote(undefined); }} /></label>
      {quote && <div className="mt-4 rounded-lg border border-white/8 p-3 text-sm"><p>Receive ~ {formatUnits(quote.amountOut, side === "buy" ? tokenDecimals ?? 18 : ARC_USDC_TOKEN_DECIMALS)} {side === "buy" ? symbol : "ERC20 USDC"}</p><p className="mt-1 text-zinc-500">Minimum received {formatUnits(quote.minimumOut, side === "buy" ? tokenDecimals ?? 18 : ARC_USDC_TOKEN_DECIMALS)} · Pool fee 1%</p></div>}
      {error && status === "error" && <p className="status-box status-error mt-4 text-sm" role="alert">{error}</p>}
      <button className="button-primary mt-5 w-full" type="button" disabled={!quote || pending || status === "quoting"} onClick={() => dispatchModal({ type: "review" })}>{status === "quoting" ? "Quoting…" : "Review swap"}</button>
      <details className="mt-4 text-xs text-zinc-600"><summary>Execution details</summary><p className="mt-2 break-all">Pool {canonicalPoolAddress}<br />SwapRouter {poolQuery.data?.router}<br />{selectedCooketChainName} · quote deadline 5 minutes<br />No validated indexed active V3 liquidity is available, so Cooket does not infer or cap price impact.</p></details>
    </>}
    <TransactionModal open={modal.open} title={`${status === "awaiting_approval" || status === "approval_confirming" ? "Approve" : "Swap"} ${symbol}`} phase={modal.phase} wallet={wallet} hash={hash} error={error} onClose={() => dispatchModal({ type: "close" })} onConfirm={() => void submit()} confirmLabel={quote && stateQuery.data && stateQuery.data.allowance < quote.amountIn ? "Start approval + swap" : "Confirm swap"} confirmDisabled={Boolean(guard)} details={quote ? [
      { label: "Input", value: `${formatUnits(quote.amountIn, side === "buy" ? ARC_USDC_TOKEN_DECIMALS : tokenDecimals ?? 18)} ${side === "buy" ? "ERC20 USDC" : symbol}` },
      { label: "Expected output", value: `${formatUnits(quote.amountOut, side === "buy" ? tokenDecimals ?? 18 : ARC_USDC_TOKEN_DECIMALS)} ${side === "buy" ? symbol : "ERC20 USDC"}` },
      { label: "Minimum output", value: formatUnits(quote.minimumOut, side === "buy" ? tokenDecimals ?? 18 : ARC_USDC_TOKEN_DECIMALS) },
      { label: "Slippage", value: `${slippage}%` }, { label: "Pool fee", value: "1%" },
      { label: "Quote expires", value: new Date(Number(quote.deadline) * 1000).toLocaleTimeString() },
    ] : []} statusLabel={status === "refreshing_state" ? `Confirming token allowance on ${selectedCooketChainName}` : undefined} />
  </section>;
}

type Sender = (transaction: GraduatedSwapTransaction, label: string) => Promise<Hash>;

export function walletTransport(client: WalletClient, wallet: Address): Sender {
  return async (transaction) => {
    assertArcProtocolEconomicsReady();
    await assertActiveWalletClient(client, wallet);
    return client.sendTransaction({ account: wallet, chain: selectedCooketChain, ...transaction });
  };
}

async function approveExactly(send: Sender, token: Address, router: Address, amount: bigint, wallet: Address, setHash: (hash: Hash) => void, setStatus: (status: SwapStatus) => void) {
  setStatus("awaiting_approval");
  const approvalHash = await send(approvalCall(token, router, amount), "Approve token");
  setHash(approvalHash);
  setStatus("approval_confirming");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("The token approval transaction reverted.");
  setStatus("approval_confirmed");
  // The caller rereads allowance after confirmation before building a swap payload.
  void wallet;
}

function rejectStaleQuote(setQuote: (quote: undefined) => void, setStatus: (status: SwapStatus) => void, setError: (error: string) => void) {
  setQuote(undefined);
  setStatus("error");
  setError("This quote is stale or the wallet/network changed. Request a fresh quote.");
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

function swapErrorMessage(reason: unknown): string {
  const message = errorMessage(reason);
  if (reason instanceof GraduatedSwapRpcTimeoutError) return `${message} No wallet request was made. Check the Arc Testnet RPC connection and try again.`;
  if (reason instanceof GraduatedSwapRpcError) return `Arc Testnet RPC could not refresh token allowance. Check the network connection and try again. No wallet request was made.`;
  return message;
}

function validateSwapInput(amount: string, decimals: number, side: "buy" | "sell", state: State | undefined, symbol: string): bigint {
  const parsed = parseUnits(amount, decimals);
  if (parsed <= BigInt(0)) throw new Error("Enter an amount greater than zero before reviewing the swap.");
  if (side === "buy" && state && parsed > state.usdc) throw new Error("Insufficient canonical ERC20 USDC balance.");
  if (side === "sell" && state && parsed > state.token) throw new Error(`Insufficient ${symbol} balance.`);
  return parsed;
}

function swapModalPhase(status: SwapStatus, side: "buy" | "sell"): TransactionModalPhase | undefined {
  return ({ idle: undefined, quoting: undefined, awaiting_approval: "awaiting_approval", approval_confirming: "approval_submitted", approval_confirmed: "approval_confirmed", refreshing_state: "refreshing_state", awaiting_wallet: side === "sell" ? "awaiting_sell_signature" : "awaiting_wallet", submitted: side === "sell" ? "sell_submitted" : "submitted", confirming: side === "sell" ? "sell_confirming" : "confirming", confirmed: "confirmed", rejected: "rejected", error: "failed" } as const)[status];
}
