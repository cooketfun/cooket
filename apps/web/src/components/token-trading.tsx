"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { TokenTradePanel, type TradeExecution, type TradeResume } from "@/components/token-trade-panel";
import { GraduatedTokenSwap } from "@/components/graduated-token-swap";
import { api } from "@/lib/api";
import { formatNative, formatTokenAmount } from "@/lib/format";
import { captureTradeRecovery, checkTrade, confirmTrade, quoteBuyByBudget, quoteSellAmount, readCurveAvailability, readTradeState, submitBuy, submitSell } from "@/lib/contracts";
import type { TradeRecovery } from "@/lib/transactions";
import { activeWalletStatusMessage, useActiveWallet } from "@/providers/active-wallet-provider";
import { explorerTransactionURL, selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";

export function TokenTrading({ tokenAddress, symbol, tokenPriceWei, graduated = false, canonicalPoolAddress }: { tokenAddress: Address; symbol: string; creator: Address; tokenPriceWei?: string | null; graduated?: boolean; canonicalPoolAddress?: Address }) {
  if (graduated) return <GraduatedTokenSwap tokenAddress={tokenAddress} canonicalPoolAddress={canonicalPoolAddress} symbol={symbol} />;
  return <BrowserWalletTokenTrading tokenAddress={tokenAddress} symbol={symbol} tokenPriceWei={tokenPriceWei} />;
}

function BrowserWalletTokenTrading({ tokenAddress, symbol, tokenPriceWei }: { tokenAddress: Address; symbol: string; tokenPriceWei?: string | null }) {
  const { connected, canTransact, status, activeAddress: walletAddress, activeChainId: chainId, walletClient } = useActiveWallet();
  const queryClient = useQueryClient();
  const stateQuery = useQuery({
    queryKey: activeTradeStateQueryKey(tokenAddress, walletAddress),
    queryFn: () => loadActiveTradeState(tokenAddress, walletAddress),
    refetchInterval: 15_000,
  });
  const availabilityQuery = useQuery({
    queryKey: ["curve-availability", tokenAddress],
    queryFn: () => readCurveAvailability(tokenAddress),
    refetchInterval: 15_000,
  });
  const quoteBuy = async (budget: bigint, slippageBps: number) => {
    if (!stateQuery.data) throw new Error("Curve state is not available yet.");
    return quoteBuyByBudget(tokenAddress, budget, stateQuery.data, slippageBps);
  };
  const quoteSell = (tokenAmount: bigint, slippageBps: number) => quoteSellAmount(tokenAddress, tokenAmount, slippageBps);

  const execute: TradeExecution = async (quote, report, assertSubmissionReady) => {
    if (chainId !== selectedCooketChainId || !walletAddress || !walletClient) throw new Error(`Connect a browser wallet on ${selectedCooketChainName} before trading.`);
    report("preparing");
    assertSubmissionReady();
    let hash;
    if (quote.side === "buy") {
      report("awaiting_wallet");
      hash = await submitBuy(walletClient, walletAddress, tokenAddress, quote, assertSubmissionReady);
    } else {
      hash = await submitSell(walletClient, walletAddress, tokenAddress, quote, {
        onApprovalRequested: () => report("awaiting_approval"),
        onApprovalSubmitted: (approvalHash) => report("approval_confirming", approvalHash),
        onApprovalConfirmed: () => report("approval_confirmed"),
        onSellPreparing: () => report("preparing_sell"),
        onSellRequested: () => report("awaiting_sell_signature"),
      }, assertSubmissionReady);
    }
    report("submitted", hash);
    const recovery = await captureTradeRecovery(hash);
    report("confirming", hash, recovery);
    return confirmTrade(hash, quote.side, tokenAddress, walletAddress, recovery);
  };

  const resume: TradeResume = async (side, hash, recovery, report) => {
    if (!walletAddress) throw new Error("The active wallet is unavailable.");
    report("confirming", hash);
    return confirmTrade(hash, side, tokenAddress, walletAddress, recovery);
  };

  const check = (side: "buy" | "sell", hash: `0x${string}`, recovery?: TradeRecovery) => {
    if (!walletAddress) throw new Error("The active wallet is unavailable.");
    return checkTrade(hash, side, tokenAddress, walletAddress, recovery);
  };

  const onConfirmed = () => {
    void Promise.all(tradeInvalidationKeys(tokenAddress).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };

  if (availabilityQuery.isError) return <div className="status-box status-error"><strong>Curve read failed on {selectedCooketChainName}.</strong><span className="mt-2 block break-words text-sm">{availabilityQuery.error.message}</span></div>;
  if (availabilityQuery.isPending) return <div className="status-box text-zinc-400">Checking the token’s {selectedCooketChainName} curve…</div>;
	if (availabilityQuery.data === null) return <div className="status-box status-warning">The canonical endpoint curve is not available for this token.</div>;
  return <TokenTradePanel
      walletConnected={connected}
      walletReady={canTransact}
      walletStatusMessage={activeWalletStatusMessage(status)}
      walletMode="browser"
      chainId={chainId}
      walletAddress={walletAddress}
      tokenAddress={tokenAddress}
      symbol={symbol}
      tokenPriceWei={tokenPriceWei}
      state={stateQuery.data}
      statePending={stateQuery.isPending}
      stateError={stateQuery.isError ? stateQuery.error.message : undefined}
      quoteBuy={quoteBuy}
      quoteSell={quoteSell}
      execute={execute}
      resume={resume}
      check={check}
      onConfirmed={onConfirmed}
    />;
}

export function tradeInvalidationKeys(tokenAddress: Address) {
  return [
    ["trade-state", tokenAddress],
    ["curve-availability", tokenAddress],
    ["trades", tokenAddress],
    ["activity", tokenAddress],
    ["token", tokenAddress],
    ["tokens"],
    ["trending"],
  ] as const;
}

export function activeTradeStateQueryKey(tokenAddress: Address, walletAddress?: Address) {
  return ["trade-state", tokenAddress, walletAddress] as const;
}

export function loadActiveTradeState(tokenAddress: Address, walletAddress?: Address) {
  return readTradeState(tokenAddress, walletAddress);
}

export function TokenTradeHistory({ tokenAddress, symbol }: { tokenAddress: Address; symbol: string }) {
  const { activeAddress } = useActiveWallet();
  return <TradeHistory tokenAddress={tokenAddress} symbol={symbol} walletAddress={activeAddress} />;
}

function TradeHistory({ tokenAddress, symbol, walletAddress }: { tokenAddress: Address; symbol: string; walletAddress?: Address }) {
  const [tab, setTab] = useState<"recent" | "yours">("recent");
  const trades = useQuery({
    queryKey: ["trades", tokenAddress],
    queryFn: () => api.trades(tokenAddress, "?limit=20"),
    refetchInterval: 15_000,
  });
  const visible = trades.data?.items.filter((trade) => tab === "recent" || (walletAddress && trade.trader.toLowerCase() === walletAddress.toLowerCase()));
  return <section className="terminal-panel min-w-0" aria-label="Indexed trade history">
    <div className="flex items-center justify-between gap-3 border-b border-white/8 p-4"><div className="flex rounded-lg border border-white/8 bg-black/20 p-0.5" role="group" aria-label="Trade history view"><button type="button" className={`min-h-9 rounded-md px-3 text-xs font-semibold ${tab === "recent" ? "bg-white/10 text-white" : "text-zinc-500"}`} aria-pressed={tab === "recent"} onClick={() => setTab("recent")}>Recent trades</button><button type="button" className={`min-h-9 rounded-md px-3 text-xs font-semibold ${tab === "yours" ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-500"}`} aria-pressed={tab === "yours"} disabled={!walletAddress} onClick={() => setTab("yours")}>Your trades</button></div><span className="badge-neutral">Finalized</span></div>
    <p className="px-4 pt-3 text-xs leading-5 text-zinc-600">The “Your trades” view filters the currently loaded recent records for the active wallet.</p>
    {trades.isPending && <p className="mt-5 text-sm text-zinc-400">Loading trade history…</p>}
    {trades.isError && <p className="mt-5 text-sm text-red-300">Trade history could not be loaded.</p>}
    {visible?.length === 0 && <p className="m-4 text-sm text-zinc-400">{tab === "yours" ? "No trades from the active wallet are present in the recent indexed window." : "No indexed trades yet."}</p>}
    {visible && visible.length > 0 && <ul className="grid divide-y divide-white/6">
      {visible.map((trade) => <li className="grid gap-3 p-4 text-sm transition-colors hover:bg-white/[0.02] lg:grid-cols-[minmax(7rem,0.6fr)_minmax(12rem,1.3fr)_minmax(10rem,1fr)_auto] lg:items-center" key={`${trade.transaction_hash}:${trade.log_index}`}>
        <div className="flex items-center justify-between gap-3"><span className={trade.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{trade.side.toUpperCase()}</span><span className="font-mono text-xs text-zinc-600">{trade.source === "uniswap_v3" ? "Legacy Uniswap V3" : "Curve"} · #{trade.block_number}</span></div>
        <div><p className="font-medium text-zinc-100">{formatNative(trade.reserve_amount)}</p><p className="mt-0.5 text-xs text-zinc-500">{formatTokenAmount(trade.token_amount, 18, symbol)}</p></div>
        <p className="address truncate" title={trade.trader}>{trade.trader}</p>
        <a className="inline-flex min-h-11 items-center text-cyan-300 hover:text-cyan-200 lg:justify-end lg:text-right" href={explorerTransactionURL(trade.transaction_hash)} target="_blank" rel="noreferrer">View on ArcScan ↗</a>
      </li>)}
    </ul>}
  </section>;
}
