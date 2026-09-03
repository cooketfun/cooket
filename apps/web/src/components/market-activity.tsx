"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Token, Trade } from "@cooket/types";
import { api } from "@/lib/api";
import { formatNative, formatTokenAmount } from "@/lib/format";
import { explorerTransactionURL } from "@/lib/chain";

type MarketTrade = Trade & { token: Pick<Token, "address" | "name" | "symbol"> };

export function MarketActivity() {
  const query = useQuery({ queryKey: ["market-activity"], queryFn: loadMarketActivity, refetchInterval: 15_000 });
  if (query.isPending) return <div className="panel grid gap-2">{Array.from({ length: 5 }, (_, index) => <div className="skeleton h-14 rounded-lg" key={index} />)}</div>;
  if (query.isError) return <div className="status-box status-error">Recent indexed activity could not be loaded.</div>;
  if (query.data.length === 0) return <div className="status-box text-zinc-400">No recent trades are available for the currently indexed launches.</div>;
  return <div className="panel overflow-hidden p-0"><div className="safe-scroll"><table className="w-full min-w-[42rem] text-left text-sm"><thead className="border-b border-white/8 bg-white/[0.02] text-[0.68rem] uppercase tracking-[0.12em] text-zinc-600"><tr><th className="px-4 py-3 font-medium">Token</th><th className="px-4 py-3 font-medium">Side</th><th className="px-4 py-3 text-right font-medium">Token amount</th><th className="px-4 py-3 text-right font-medium">Trade value</th><th className="px-4 py-3 text-right font-medium">Block</th></tr></thead><tbody className="divide-y divide-white/6">{query.data.map((trade) => <tr className="transition-colors hover:bg-white/[0.025]" key={`${trade.transaction_hash}:${trade.log_index}`}><td className="px-4 py-3"><Link className="font-medium text-zinc-100 hover:text-cyan-200" href={`/token/${trade.token.address}`}>{trade.token.name} <span className="text-xs text-zinc-500">{trade.token.symbol}</span></Link></td><td className="px-4 py-3"><span className={trade.side === "buy" ? "text-emerald-300" : "text-rose-300"}>{trade.side.toUpperCase()}</span></td><td className="px-4 py-3 text-right text-zinc-300">{formatTokenAmount(trade.token_amount, 18, trade.token.symbol)}</td><td className="px-4 py-3 text-right"><span className="font-medium text-zinc-100">{formatNative(trade.reserve_amount)}</span></td><td className="px-4 py-3 text-right font-mono text-xs text-zinc-500"><a href={explorerTransactionURL(trade.transaction_hash)} target="_blank" rel="noreferrer" className="hover:text-cyan-300">{trade.block_number} ↗</a></td></tr>)}</tbody></table></div></div>;
}

async function loadMarketActivity(): Promise<MarketTrade[]> {
  const tokens = await api.listTokens("?limit=8");
  const pages = await Promise.all(tokens.items.map(async (token) => ({ token, trades: await api.trades(token.address, "?limit=3") })));
  return pages.flatMap(({ token, trades }) => trades.items.map((trade) => ({ ...trade, token: { address: token.address, name: token.name, symbol: token.symbol } }))).sort((a, b) => b.block_number - a.block_number || b.log_index - a.log_index).slice(0, 12);
}
