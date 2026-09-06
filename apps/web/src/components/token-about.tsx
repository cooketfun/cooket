"use client";

import Link from "next/link";
import type { Token } from "@cooket/types";
import type { ReactNode } from "react";
import { CopyableAddress } from "@/components/copyable-address";
import { selectedCooketChainName } from "@/lib/chain";
import { formatCount, formatExactUSDC, formatMarketUSDC, formatPrice, formatTokenAmount, formatTokenSymbol } from "@/lib/format";
import { formatAbsoluteUTC, formatRelativeAge, useUnixNow } from "@/lib/relative-time";

export function TokenAbout({ token }: { token: Token }) {
  const now = useUnixNow();
  const buys = token.metrics.buy_count;
  const sells = token.metrics.sell_count;
  const trades = buys + sells;
  const buyShare = trades > 0 ? Math.round((buys / trades) * 100) : null;
  const lifecycle = lifecycleLabel(token.graduation?.phase ?? token.curve?.lifecycle ?? (token.curve ? "active" : "Unavailable"));
  const created = token.created_at.block_timestamp !== undefined && now !== null
    ? <time title={formatAbsoluteUTC(token.created_at.block_timestamp)}>{formatRelativeAge(token.created_at.block_timestamp, now)} ago</time>
    : <>Block {token.created_at.block_number}</>;
  const xSearch = `https://x.com/search?q=${encodeURIComponent(`${token.name} ${formatTokenSymbol(token.symbol)}`)}`;

  return <section className="terminal-panel overflow-hidden" aria-labelledby="about-token-heading">
    <div className="border-b border-white/8 p-4 sm:p-5">
      <p className="eyebrow">Token information</p>
      <h2 id="about-token-heading" className="mt-2 text-xl font-semibold text-white">About {formatTokenSymbol(token.symbol)}</h2>
      <p className={`mt-3 text-sm leading-7 ${token.description ? "text-zinc-300" : "text-zinc-500"}`}>{token.description || "No description found"}</p>
    </div>

    <div className="grid gap-px bg-white/6 sm:grid-cols-2 lg:grid-cols-4">
      <AboutStat label="Volume" value={formatMarketUSDC(token.metrics.volume)} title={formatExactUSDC(token.metrics.volume)} />
      <AboutStat label="Current price" value={formatPrice(token.metrics.current_price)} title={formatExactUSDC(token.metrics.current_price)} />
      <AboutStat label="Traders" value={formatCount(token.metrics.unique_trader_count)} />
      <AboutStat label="Holders" value={formatCount(token.metrics.holder_count)} />
    </div>

    <div className="border-t border-white/8 p-4 sm:p-5">
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-[0.65rem] uppercase tracking-[0.12em] text-zinc-600">Buys</p><p className="mt-1 text-lg font-semibold text-emerald-300">{formatCount(buys)}</p></div>
        <div className="text-right"><p className="text-[0.65rem] uppercase tracking-[0.12em] text-zinc-600">Sells</p><p className="mt-1 text-lg font-semibold text-rose-300">{formatCount(sells)}</p></div>
      </div>
      {buyShare !== null && <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-zinc-800" aria-label={`${buyShare}% buys and ${100 - buyShare}% sells`}><span className="bg-emerald-400" style={{ width: `${buyShare}%` }} /><span className="bg-rose-400" style={{ width: `${100 - buyShare}%` }} /></div>}
    </div>

    <div className="grid border-t border-white/8 sm:grid-cols-2">
      <div className="border-b border-white/8 p-4 sm:border-r sm:border-b-0 sm:p-5">
        <p className="text-[0.65rem] uppercase tracking-[0.12em] text-zinc-600">Token facts</p>
        <dl className="mt-4 grid gap-3 text-sm">
          <Fact label="Supply" value={formatTokenAmount(token.initial_supply, 18, token.symbol)} />
          <Fact label="Network" value={selectedCooketChainName} />
          <Fact label="Lifecycle" value={lifecycle} />
          <Fact label="Created" value={created} />
        </dl>
        <div className="mt-3 flex items-center justify-between gap-4 text-sm"><span className="text-zinc-600">Contract</span><CopyableAddress address={token.address} /></div>
      </div>
      <div className="p-4 sm:p-5">
        <p className="text-[0.65rem] uppercase tracking-[0.12em] text-zinc-600">Links</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {token.website_url && <SocialAction href={token.website_url} label="Website" />}
          {token.x_url && <SocialAction href={token.x_url} label="X / Twitter" />}
          {token.telegram_url && <SocialAction href={token.telegram_url} label="Telegram" />}
          {token.discord_url && <SocialAction href={token.discord_url} label="Discord" />}
          <SocialAction href={xSearch} label="Search on X" />
        </div>
        <div className="mt-5 border-t border-white/8 pt-4"><p className="text-xs text-zinc-600">Creator</p><Link className="address mt-2 block truncate text-cyan-300 hover:text-cyan-200" href={`/creator/${token.creator}`}>{token.creator}</Link></div>
      </div>
    </div>
  </section>;
}

function AboutStat({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="min-w-0 bg-[#0d1322] p-4"><p className="text-[0.65rem] uppercase tracking-[0.12em] text-zinc-600">{label}</p><p className="mt-1.5 truncate text-base font-semibold text-zinc-100" title={title ?? value}>{value}</p></div>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-start justify-between gap-4"><dt className="text-zinc-600">{label}</dt><dd className="text-right font-medium text-zinc-300">{value}</dd></div>;
}

function SocialAction({ href, label }: { href: string; label: string }) {
  return <a className="button-secondary min-h-10 px-3 text-xs" href={href} target="_blank" rel="noreferrer">{label} ↗</a>;
}

function lifecycleLabel(value: string) {
  return value.split(/[_-]/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}
