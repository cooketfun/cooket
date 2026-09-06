"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { TokenTradePanel, type TradeExecution, type TradeResume } from "@/components/token-trade-panel";
import { GraduatedTokenSwap } from "@/components/graduated-token-swap";
import { api } from "@/lib/api";
import { formatExactTokenAmount, formatMarketTradeUSDC, formatTradeUsdc, formatTokenAmount } from "@/lib/format";
import { captureTradeRecovery, checkTrade, confirmTrade, quoteBuyByBudget, quoteSellAmount, readCurveAvailability, readTradeState, submitBuy, submitSell } from "@/lib/contracts";
import type { TradeRecovery } from "@/lib/transactions";
import { activeWalletStatusMessage, useActiveWallet } from "@/providers/active-wallet-provider";
import { explorerTransactionURL, selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";
import { formatAbsoluteUTC, formatRelativeAge, useUnixNow } from "@/lib/relative-time";
import { curveActor, reconcileRealtimeTrades, type RealtimeTrade } from "@/lib/token-realtime";

export function TokenTrading({ tokenAddress, symbol, tokenImageURL, tokenPriceWei, graduated = false, canonicalPoolAddress }: { tokenAddress: Address; symbol: string; tokenImageURL?: string; creator: Address; tokenPriceWei?: string | null; graduated?: boolean; canonicalPoolAddress?: Address }) {
  if (graduated) return <GraduatedTokenSwap tokenAddress={tokenAddress} canonicalPoolAddress={canonicalPoolAddress} symbol={symbol} tokenImageURL={tokenImageURL} />;
  return <BrowserWalletTokenTrading tokenAddress={tokenAddress} symbol={symbol} tokenImageURL={tokenImageURL} tokenPriceWei={tokenPriceWei} />;
}

function BrowserWalletTokenTrading({ tokenAddress, symbol, tokenImageURL, tokenPriceWei }: { tokenAddress: Address; symbol: string; tokenImageURL?: string; tokenPriceWei?: string | null }) {
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
	if (availabilityQuery.data === null) return <div className="status-box status-warning">Trading is not available for this token.</div>;
  return <TokenTradePanel
      walletConnected={connected}
      walletReady={canTransact}
      walletStatusMessage={activeWalletStatusMessage(status)}
      walletMode="browser"
      chainId={chainId}
      walletAddress={walletAddress}
      tokenAddress={tokenAddress}
      symbol={symbol}
      tokenImageURL={tokenImageURL}
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
    ["token-activity", tokenAddress],
    ["token-chart", tokenAddress],
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

export function TokenTradeHistory({ tokenAddress, symbol, provisional = [], onIndexedThroughBlock }: { tokenAddress: Address; symbol: string; provisional?: readonly RealtimeTrade[]; onIndexedThroughBlock?: (block: number | undefined) => void }) {
  const { activeAddress } = useActiveWallet();
  return <TradeHistory tokenAddress={tokenAddress} symbol={symbol} walletAddress={activeAddress} provisional={provisional} onIndexedThroughBlock={onIndexedThroughBlock} />;
}

export function TradeHistory({ tokenAddress, symbol, walletAddress, provisional, onIndexedThroughBlock }: { tokenAddress: Address; symbol: string; walletAddress?: Address; provisional: readonly RealtimeTrade[]; onIndexedThroughBlock?: (block: number | undefined) => void }) {
  const now = useUnixNow();
  const [tab, setTab] = useState<"recent" | "yours">("recent");
  const trades = useQuery({
    queryKey: ["trades", tokenAddress],
    queryFn: () => api.trades(tokenAddress, "?limit=20"),
    refetchInterval: 5_000,
  });
  const pending = reconcileRealtimeTrades(provisional, trades.data?.indexed_through_block, trades.data?.items).slice().reverse();
  useEffect(() => { if (trades.data?.indexed_through_block !== undefined) onIndexedThroughBlock?.(trades.data.indexed_through_block); }, [onIndexedThroughBlock, trades.data?.indexed_through_block]);
  const visible = trades.data?.items.filter((trade) => tab === "recent" || (walletAddress && trade.source === "curve" && trade.trader.toLowerCase() === walletAddress.toLowerCase()));
  const pendingVisible = pending.filter((trade) => tab === "recent" || (walletAddress && curveActor(trade)?.toLowerCase() === walletAddress.toLowerCase()));
  return <section className="terminal-panel min-w-0 overflow-hidden" aria-label="Recent trade history">
    <div className="border-b border-white/8 p-3 sm:p-4"><div className="flex w-full rounded-lg border border-white/8 bg-black/20 p-0.5 sm:w-fit" role="tablist" aria-label="Trade history view"><button type="button" role="tab" className={`min-h-9 flex-1 rounded-md px-3 text-xs font-semibold sm:flex-none ${tab === "recent" ? "bg-white/10 text-white" : "text-zinc-500"}`} aria-selected={tab === "recent"} onClick={() => setTab("recent")}>Recent trades</button><button type="button" role="tab" className={`min-h-9 flex-1 rounded-md px-3 text-xs font-semibold sm:flex-none ${tab === "yours" ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-500"}`} aria-selected={tab === "yours"} disabled={!walletAddress} onClick={() => setTab("yours")}>Your trades</button></div>
      <p className="mt-2 text-[0.68rem] leading-5 text-zinc-600">Your trades filters the currently loaded recent records for the active wallet.</p>
    </div>
    {trades.isPending && <p className="p-4 text-sm text-zinc-400">Loading trade history…</p>}
    {trades.isError && <p className="p-4 text-sm text-red-300">Trade history could not be loaded.</p>}
    {visible?.length === 0 && pendingVisible.length === 0 && <p className="m-4 text-sm text-zinc-400">{tab === "yours" ? "No recent trades from this wallet." : "No trades yet."}</p>}
    {(pendingVisible.length > 0 || (visible && visible.length > 0)) && <ul className="grid divide-y divide-white/6">
      {pendingVisible.map((trade) => <TradeRow key={trade.identity} side={trade.side} blockNumber={trade.block_number} blockTimestamp={trade.block_timestamp} marketRaw={trade.usdc_amount_raw} tokenRaw={trade.token_amount_raw} source={trade.source} symbol={symbol} trader={curveActor(trade)} transactionHash={trade.transaction_hash} now={now} provisional />)}
      {(visible ?? []).map((trade) => <TradeRow key={`${trade.transaction_hash}:${trade.log_index}`} side={trade.side} blockNumber={trade.block_number} blockTimestamp={trade.block_timestamp} marketRaw={trade.reserve_amount} tokenRaw={trade.token_amount} source={trade.source} symbol={symbol} trader={trade.source === "curve" ? trade.trader : undefined} transactionHash={trade.transaction_hash} now={now} />)}
    </ul>}
  </section>;
}

function TradeRow({ side, blockNumber, blockTimestamp, marketRaw, tokenRaw, source, symbol, trader, transactionHash, now, provisional = false }: {
  side: string; blockNumber: number; blockTimestamp?: number; marketRaw: string; tokenRaw: string; source: "curve" | "uniswap_v3"; symbol: string; trader?: string; transactionHash: string; now: number | null; provisional?: boolean;
}) {
  const time = blockTimestamp !== undefined && now !== null
    ? <time title={formatAbsoluteUTC(blockTimestamp)}>{formatRelativeAge(blockTimestamp, now)} ago</time>
    : <>Block {blockNumber}</>;
  return <li className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 p-3 text-sm transition-colors hover:bg-white/[0.025] sm:p-4 lg:grid-cols-[5rem_7rem_minmax(7rem,0.8fr)_minmax(9rem,1fr)_minmax(10rem,1.3fr)_auto] lg:items-center" data-provisional={provisional || undefined}>
    <TradeCell label="Side"><span className={`font-semibold tracking-wide ${side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{side.toUpperCase()}</span></TradeCell>
    <TradeCell label="Time"><span className="font-mono text-xs text-zinc-500">{time}</span></TradeCell>
    <TradeCell label="Market value"><span className="font-semibold text-zinc-100" title={formatTradeUsdc(marketRaw, source)}>{formatMarketTradeUSDC(marketRaw, source)}</span></TradeCell>
    <TradeCell label="Token amount"><span className="text-zinc-300" title={formatExactTokenAmount(tokenRaw, 18, symbol)}>{formatTokenAmount(tokenRaw, 18, symbol)}</span></TradeCell>
    <TradeCell label="Trader"><span className={`block truncate ${trader ? "address text-zinc-400" : "text-xs text-zinc-600"}`} title={trader}>{trader ?? "Trader unavailable"}</span></TradeCell>
    <div className="col-span-2 flex items-end lg:col-span-1 lg:justify-end"><a className="inline-flex min-h-10 items-center whitespace-nowrap text-xs font-medium text-cyan-300 hover:text-cyan-200" href={explorerTransactionURL(transactionHash)} target="_blank" rel="noreferrer">View on ArcScan ↗</a></div>
  </li>;
}

function TradeCell({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><span className="mb-1 block text-[0.62rem] uppercase tracking-[0.12em] text-zinc-700 lg:hidden">{label}</span>{children}</div>;
}
