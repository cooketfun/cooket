"use client";

import Link from "next/link";
import type { Token } from "@cooket/types";
import { apiAssetURL } from "@/lib/api";
import { formatCount, formatWeiUsd, graduationProgress } from "@/lib/format";
import { useOraclePrice } from "@/providers/oracle-price-provider";

export function TokenCard({ token, variant = "grid" }: { token: Token; variant?: "grid" | "list" }) {
  const { reference } = useOraclePrice();
  const progress = graduationProgress(token.curve?.sold_supply, token.curve?.graduation_threshold);
  const image = <TokenImage token={token} className={variant === "list" ? "h-20 w-20 rounded-xl sm:h-24 sm:w-24" : "aspect-[4/3] w-full rounded-xl"} />;

  if (variant === "list") return <article className="group market-card relative flex min-w-0 items-center gap-3 p-3 transition-colors hover:border-cyan-300/30 hover:bg-[#0d1721] sm:gap-4">
    <CardLink token={token} />
    {image}
    <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(8rem,1.25fr)_repeat(4,minmax(5rem,.7fr))] sm:items-center sm:gap-4">
      <div className="min-w-0"><Identity token={token} /><p className="mt-2 truncate text-xs font-semibold text-zinc-300 sm:hidden">{formatWeiUsd(token.metrics.current_price, reference)}</p><p className="mt-1 truncate text-[0.62rem] text-zinc-600 sm:hidden">{formatCount(token.metrics.holder_count)} holders</p></div>
      <ListMetric label="Price" value={formatWeiUsd(token.metrics.current_price, reference)} />
      <ListMetric label="24h" value="—" unavailable />
      <ListMetric label="FDV" value={formatWeiUsd(token.metrics.fully_diluted_value, reference)} />
      <ListMetric label="Volume" value={formatWeiUsd(token.metrics.volume, reference)} />
    </div>
    <div className="relative z-10 hidden w-28 flex-none sm:block"><Progress value={progress} compact /></div>
    <span className="hidden flex-none text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-300 sm:block" aria-hidden>→</span>
  </article>;

  return <article className="group market-card relative min-w-0 overflow-hidden transition duration-150 hover:border-cyan-300/30 hover:bg-[#0d1721] max-md:flex max-md:min-h-16 max-md:items-center max-md:gap-3 max-md:p-3 md:hover:-translate-y-0.5">
    <CardLink token={token} />
    <div className="relative max-md:flex-none p-2 pb-0 max-md:p-0">
      <TokenImage token={token} className="aspect-[4/3] w-full rounded-xl max-md:h-14 max-md:w-14 max-md:aspect-auto" />
      <span className="absolute left-4 top-4 rounded-full border border-black/20 bg-black/65 px-2 py-1 text-[0.62rem] font-semibold text-zinc-200 backdrop-blur max-md:hidden">Block #{formatCount(token.created_at.block_number)}</span>
      {token.x_url && <span className="absolute right-4 top-4 rounded-full border border-cyan-300/20 bg-[#071219]/85 px-2 py-1 text-[0.62rem] font-bold text-cyan-200 backdrop-blur max-md:hidden">X linked</span>}
    </div>
    <div className="min-w-0 flex-1 p-3.5 max-md:p-0">
      <Identity token={token} />
      <div className="mt-3 flex items-end justify-between gap-3 border-b border-white/7 pb-3 max-md:mt-1.5 max-md:border-0 max-md:pb-0">
        <div className="min-w-0"><p className="text-[0.65rem] text-zinc-600 max-md:hidden">USD price</p><p className="mt-0.5 truncate text-base font-semibold text-zinc-50 max-md:text-sm" title={formatWeiUsd(token.metrics.current_price, reference)}>{formatWeiUsd(token.metrics.current_price, reference)}</p></div>
        <div className="text-right" title="The current API does not expose a 24-hour price-change field"><p className="text-[0.65rem] text-zinc-600">24h</p><p className="mt-0.5 text-sm font-semibold text-zinc-600">—</p></div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 max-md:mt-2">
        <Metric label="FDV" value={formatWeiUsd(token.metrics.fully_diluted_value, reference)} />
        <Metric label="Volume" value={formatWeiUsd(token.metrics.volume, reference)} />
        <Metric label="Holders" value={formatCount(token.metrics.holder_count)} />
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/7 pt-3 text-[0.68rem] max-md:hidden">
        <p className="min-w-0 text-zinc-600">Age <span className="ml-1 text-zinc-400" title="The current API exposes launch block provenance but not launch time">—</span></p>
        <p className="min-w-0 truncate text-right text-zinc-600">Creator <span className="font-mono text-zinc-400">{shortAddress(token.creator)}</span></p>
      </div>
      <div className="max-md:hidden"><Progress value={progress} /></div>
    </div>
  </article>;
}

export function TopTokenCard({ token, rank }: { token: Token; rank: number }) {
  const { reference } = useOraclePrice();
  return <article className="top-token-card group relative">
    <CardLink token={token} />
    <span className="absolute left-2 top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-md border border-white/10 bg-black/70 px-1 text-[0.6rem] font-bold text-zinc-300">{rank}</span>
    <TokenImage token={token} className="h-16 w-16 rounded-xl" />
    <div className="min-w-0 flex-1">
      <Identity token={token} compact />
      <div className="mt-2 flex items-end justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{formatWeiUsd(token.metrics.current_price, reference)}</p><p className="mt-0.5 text-[0.62rem] text-zinc-600">USD price</p></div><div className="text-right" title="The current API does not expose a 24-hour price-change field"><p className="text-xs font-semibold text-zinc-600">—</p><p className="mt-0.5 text-[0.62rem] text-zinc-600">24h</p></div></div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/7 pt-2 text-[0.65rem] text-zinc-600"><span>Vol <strong className="font-medium text-zinc-400">{formatWeiUsd(token.metrics.volume, reference)}</strong></span><span>{formatCount(token.metrics.holder_count)} holders</span></div>
    </div>
  </article>;
}

function CardLink({ token }: { token: Token }) {
  return <Link href={`/token/${token.address}`} aria-label={`Open ${token.name}`} className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" />;
}

function TokenImage({ token, className }: { token: Token; className: string }) {
  return token.image_url
    ? <div role="img" aria-label={`${token.name} token artwork`} className={`${className} flex-none border border-white/8 bg-cover bg-center bg-no-repeat`} style={{ backgroundImage: `url(${apiAssetURL(token.image_url)})` }} />
    : <div aria-hidden className={`${className} flex flex-none items-center justify-center border border-cyan-300/12 bg-[radial-gradient(circle_at_30%_20%,rgba(103,232,249,.18),transparent_48%),linear-gradient(145deg,#101d28,#071018)] text-3xl font-semibold text-cyan-200`}>{token.symbol.slice(0, 1)}</div>;
}

function Identity({ token, compact = false }: { token: Token; compact?: boolean }) {
  return <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className={`${compact ? "text-sm" : "text-[0.95rem]"} truncate font-semibold text-white transition-colors group-hover:text-cyan-100`}>{token.name}</h3>{token.graduation?.phase && <span className="h-1.5 w-1.5 flex-none rounded-full bg-violet-300" title={token.graduation.phase} />}</div><p className="mt-0.5 truncate text-[0.65rem] font-bold uppercase tracking-[0.14em] text-cyan-300">{token.symbol}</p></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[0.62rem] text-zinc-600">{label}</dt><dd className="mt-0.5 truncate text-xs font-medium text-zinc-300" title={value}>{value}</dd></div>;
}

function ListMetric({ label, value, unavailable = false }: { label: string; value: string; unavailable?: boolean }) {
  return <div className="mt-2 hidden min-w-0 sm:block"><p className="text-[0.62rem] text-zinc-600">{label}</p><p className={`mt-1 truncate text-xs font-medium ${unavailable ? "text-zinc-600" : "text-zinc-300"}`}>{value}</p></div>;
}

function Progress({ value, compact = false }: { value: number | null; compact?: boolean }) {
  if (value === null) return <div className={compact ? "" : "mt-3"}><div className="flex items-center justify-between text-[0.62rem] text-zinc-600"><span>Graduation</span><span>Not indexed</span></div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/6" /></div>;
  return <div className={compact ? "" : "mt-3"}><div className="flex items-center justify-between text-[0.62rem]"><span className="text-zinc-600">Graduation</span><span className="font-medium text-zinc-400">{value.toFixed(value >= 10 ? 1 : 2)}%</span></div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/6"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300" style={{ width: `${value}%` }} /></div></div>;
}

function shortAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
