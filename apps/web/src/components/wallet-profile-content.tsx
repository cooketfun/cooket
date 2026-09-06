"use client";

import type { WalletHolding } from "@cooket/types";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { TokenCard } from "@/components/token-card";
import { apiAssetURL } from "@/lib/api";
import { creatorProfileQueryOptions, walletHoldingsQueryOptions } from "@/lib/canonical-queries";
import { formatExactUSDC, formatMarketUSDC, formatTokenAmount, formatTokenSymbol } from "@/lib/format";

export function WalletProfileContent({ address, surface, createdLimit }: { address: string; surface: "creator" | "public-creator"; createdLimit: number }) {
  const creator = useQuery(creatorProfileQueryOptions(surface, address, createdLimit, true));
  const holdings = useInfiniteQuery(walletHoldingsQueryOptions(address, 24, true));
  const holdingItems = holdings.data?.pages.flatMap((page) => page.items) ?? [];
  const indexedThroughBlock = holdings.data?.pages.reduce((floor, page) => Math.min(floor, page.indexed_through_block), Number.MAX_SAFE_INTEGER);
  return <div className="mt-5">
    <section className="mt-8" aria-labelledby="portfolio-heading">
      <p className="eyebrow">Portfolio</p>
      <h2 id="portfolio-heading" className="section-heading mt-2 mb-5">Holdings</h2>
      {holdings.isPending ? <PortfolioSkeleton /> : holdings.isError ? <QueryError message="Portfolio could not be loaded." retry={() => holdings.refetch()} /> : holdingItems.length === 0 ? <div className="status-box py-8 text-center text-zinc-400">No Cooket tokens held by this wallet.</div> : <><div className="grid gap-3">{holdingItems.map((holding) => <HoldingCard key={holding.token_address} holding={holding} />)}</div>{holdings.hasNextPage && <button className="button-secondary mt-4" type="button" disabled={holdings.isFetchingNextPage} onClick={() => void holdings.fetchNextPage()}>{holdings.isFetchingNextPage ? "Loading..." : "Load more holdings"}</button>}</>}
      {indexedThroughBlock !== undefined && indexedThroughBlock !== Number.MAX_SAFE_INTEGER && <p className="mt-3 text-xs text-zinc-600">Indexed through block {indexedThroughBlock.toLocaleString()}.</p>}
    </section>
    <section className="mt-10" aria-labelledby="created-tokens-heading">
      <p className="eyebrow">Launch history</p>
      <h2 id="created-tokens-heading" className="section-heading mt-2 mb-5">Created tokens</h2>
      {creator.isPending ? <div className="grid grid-cols-2 gap-3 sm:max-w-xl">{[0, 1].map((value) => <div className="panel h-24" key={value} />)}</div> : creator.isError ? <QueryError message="Created tokens could not be loaded." retry={() => creator.refetch()} /> : <><dl className="mb-5 grid max-w-xl grid-cols-2 gap-3"><Metric label="Tokens launched" value={String(creator.data.token_count)} /><Metric label="Indexed volume" value={formatMarketUSDC(creator.data.volume)} title={formatExactUSDC(creator.data.volume)} /></dl>{creator.data.tokens.length === 0 ? <div className="status-box py-8 text-center text-zinc-400">No tokens indexed for this wallet address.</div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{creator.data.tokens.map((token) => <TokenCard key={token.address} token={token} />)}</div>}</>}
    </section>
  </div>;
}

function HoldingCard({ holding }: { holding: WalletHolding }) {
  return <article className="panel-subtle flex min-w-0 items-center gap-3 p-3 sm:gap-4 sm:p-4">
    {holding.image_url ? <div role="img" aria-label={`${holding.name} token artwork`} className="h-14 w-14 flex-none rounded-xl border border-white/8 bg-cover bg-center" style={{ backgroundImage: `url(${apiAssetURL(holding.image_url)})` }} /> : <div aria-hidden className="flex h-14 w-14 flex-none items-center justify-center rounded-xl border border-cyan-300/12 bg-[#0d1322] text-lg font-semibold text-cyan-200">{holding.symbol.slice(0, 1)}</div>}
    <div className="min-w-0 flex-1"><Link className="font-semibold text-white hover:text-cyan-200" href={`/token/${holding.token_address}`}>{holding.name}</Link><p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-cyan-300">{formatTokenSymbol(holding.symbol)}</p></div>
    <dl className="grid flex-none grid-cols-1 gap-1 text-right sm:grid-cols-2 sm:gap-x-8"><div><dt className="text-[0.62rem] text-zinc-600">Balance</dt><dd className="mt-1 text-sm font-medium text-zinc-200">{formatTokenAmount(holding.raw_balance, holding.token_decimals)}</dd></div><div><dt className="text-[0.62rem] text-zinc-600">Estimated value</dt><dd className="mt-1 text-sm font-semibold text-white" title={formatExactUSDC(holding.estimated_value)}>{formatMarketUSDC(holding.estimated_value)}</dd></div></dl>
    {holding.lifecycle && <span className={holding.lifecycle === "graduated" ? "badge-violet hidden sm:inline-flex" : "badge-neutral hidden sm:inline-flex"}>{holding.lifecycle}</span>}
  </article>;
}

function PortfolioSkeleton() { return <div className="grid gap-3">{[0, 1].map((value) => <div className="panel h-20" key={value} />)}</div>; }
function QueryError({ message, retry }: { message: string; retry: () => unknown }) { return <div className="status-box status-error flex flex-col items-start gap-4"><span>{message}</span><button className="button-secondary" type="button" onClick={() => void retry()}>Try again</button></div>; }
function Metric({ label, value, title }: { label: string; value: string; title?: string }) { return <div className="panel p-4 sm:p-5"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-2 truncate text-xl font-semibold text-white sm:text-2xl" title={title ?? value}>{value}</dd></div>; }
