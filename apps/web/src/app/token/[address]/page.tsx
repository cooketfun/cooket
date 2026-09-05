"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Token } from "@cooket/types";
import { TokenTrading, TokenTradeHistory } from "@/components/token-trading";
import { TokenActivity } from "@/components/token-activity";
import { TokenAdvancedChart } from "@/components/token-advanced-chart";
import { hasIndexedSettlement, isGraduatedToken, TokenGraduation } from "@/components/token-graduation";
import { TokenCTO } from "@/components/token-cto";
import { MobileTradeActions, TokenTradeSheetProvider, TradeSheetSurface } from "@/components/mobile-trade-sheet";
import { api, apiAssetURL } from "@/lib/api";
import { explorerAddressURL, explorerTransactionURL, selectedCooketChainId, selectedCooketChainName, validAddress } from "@/lib/chain";
import { readCurveOnchain, readTokenOnchain } from "@/lib/contracts";
import { formatCount, formatExactUSDC, formatMarketUSDC, formatPrice, formatTokenAmount, formatTokenSymbol } from "@/lib/format";
import { advanceRealtimeSurfaceWatermark, overlayMetrics, reconcileRealtimeTrades, safeRealtimeRetirementFloor, useTokenRealtimeTrades, type RealtimeSurface } from "@/lib/token-realtime";

type MobileSection = "market" | "about" | "trades" | "activity";

export default function TokenDetailPage() {
  const { address } = useParams<{ address: string }>();
  const valid = validAddress(address);
  const query = useQuery({ queryKey: ["token", address], queryFn: () => api.token(address), enabled: valid });
  const trades = useQuery({ queryKey: ["trades", address], queryFn: () => api.trades(address, "?limit=20"), enabled: valid, refetchInterval: 5_000 });
  const [watermarks, setWatermarks] = useState<Partial<Record<RealtimeSurface, number>>>({});
  const observeWatermark = useCallback((surface: RealtimeSurface, block: number | undefined) => {
    setWatermarks((current) => advanceRealtimeSurfaceWatermark(current, surface, block));
  }, []);
  const retireThroughBlock = safeRealtimeRetirementFloor(watermarks);
  const realtime = useTokenRealtimeTrades(valid ? address : "", retireThroughBlock);
  const tokenWatermark = query.data?.indexed_through_block ?? 0;
  useEffect(() => { if (query.data?.indexed_through_block !== undefined) observeWatermark("token", tokenWatermark); }, [observeWatermark, query.data?.indexed_through_block, tokenWatermark]);
  const [onchain, setOnchain] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>("market");
  useEffect(() => {
    if (!valid) return;
    void Promise.all([readTokenOnchain(address), readCurveOnchain(address)])
      .then(([info, curve]) => setOnchain(info || curve ? "Available" : "Not configured"))
      .catch(() => setOnchain("Unavailable"));
  }, [address, valid]);

  if (!valid) return <PageState title="Invalid token address" copy="Check the address and try opening the token again." />;
  if (query.isPending) return <main className="token-terminal-container page-shell flex-1" aria-label="Loading indexed token"><div className="skeleton h-6 w-28 rounded" /><div className="mt-5 flex gap-5"><div className="skeleton h-20 w-20 flex-none rounded-2xl" /><div className="min-w-0 flex-1"><div className="skeleton h-9 w-64 max-w-full rounded" /><div className="skeleton mt-4 h-4 w-full max-w-xl rounded" /></div></div><div className="skeleton mt-8 h-[34rem] rounded-2xl" /></main>;
  if (query.isError) return <PageState title="Token could not be loaded" copy={query.error.message} action={() => void query.refetch()} />;
  const token = query.data;
  const provisional = reconcileRealtimeTrades(realtime, tokenWatermark);
  const liveMetrics = overlayMetrics(token, provisional);
  const liveToken = { ...token, metrics: liveMetrics };
  const graduated = isGraduatedToken(token);
  const lifecycle = lifecycleBadge(token.graduation?.phase, Boolean(token.curve));

  return <TokenTradeSheetProvider>
    <main className="token-terminal-container page-shell token-page-with-trade flex-1">
      <Link href="/" className="inline-flex min-h-11 items-center text-sm text-zinc-500 transition-colors hover:text-cyan-200"><span aria-hidden>←</span>&nbsp; Markets</Link>
      <section className="mt-2 border-b border-white/8 pb-4 md:mt-3 md:pb-6">
        <div className="flex min-w-0 flex-col gap-4 md:gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-3">
            {token.image_url ? <div role="img" aria-label={`${token.name} token image`} className="h-12 w-12 flex-none rounded-xl border border-white/10 bg-cover bg-center shadow-xl shadow-black/25 md:h-20 md:w-20 md:rounded-2xl" style={{ backgroundImage: `url(${apiAssetURL(token.image_url)})` }} /> : <div aria-hidden className="flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/7 text-xl font-semibold text-cyan-200 md:h-20 md:w-20 md:rounded-2xl md:text-2xl">{token.symbol.slice(0, 1)}</div>}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-[-0.035em] text-white md:text-2xl lg:text-3xl">{token.name}</h1>
                <span className="font-semibold uppercase tracking-[0.14em] text-cyan-300">{formatTokenSymbol(token.symbol)}</span>
                {lifecycle && <span className={lifecycle.className}>{lifecycle.label}</span>}
              </div>
              <CopyableAddress address={token.address} />
            </div>
          </div>
          <div className="min-w-0 lg:ml-auto lg:text-right">
            <p className="text-xs text-zinc-600">Indexed price</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-white md:text-2xl" title={formatExactUSDC(liveMetrics.current_price)}>{formatPrice(liveMetrics.current_price)}</p>
            <p className="mt-1 text-xs text-zinc-500">{liveMetrics.current_price ? "Per token" : "Not indexed"}</p>
          </div>
        </div>
        <div className="mt-4 hidden grid-cols-2 gap-2 sm:grid-cols-4 md:grid lg:hidden"><TopMetric label="FDV" value={formatMarketUSDC(liveMetrics.fully_diluted_value)} title={formatExactUSDC(liveMetrics.fully_diluted_value)} /><TopMetric label="Volume" value={formatMarketUSDC(liveMetrics.volume)} title={formatExactUSDC(liveMetrics.volume)} />{graduated ? <TopMetric label="LP custody" value={hasIndexedSettlement(token) ? "Permanent" : "Details pending"} /> : <TopMetric label="Curve reserve" value={formatMarketUSDC(token.curve?.reserve_balance)} title={formatExactUSDC(token.curve?.reserve_balance)} />}<TopMetric label="Holders" value={formatCount(token.metrics.holder_count)} /></div>
      </section>

      <div className="mt-4 flex gap-1 overflow-x-auto md:hidden" role="tablist" aria-label="Token sections">
        {([
          { id: "market", label: "Market" },
          { id: "about", label: "About" },
          { id: "trades", label: "Trades" },
          { id: "activity", label: "Activity" },
        ] as const).map((item) => <button key={item.id} type="button" role="tab" aria-selected={mobileSection === item.id} className={`min-h-11 flex-none rounded-lg px-3 text-sm font-semibold ${mobileSection === item.id ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-500"}`} onClick={() => setMobileSection(item.id)}>{item.label}</button>)}
      </div>

      <div className="token-terminal-layout mt-4 md:mt-5">
        <div className="token-terminal-main">
          <div className="token-terminal-primary">
            <div className="terminal-chart"><TokenAdvancedChart tokenAddress={address} initialSupply={token.initial_supply} realtimeEvents={realtime} onIndexedThroughBlock={(block) => observeWatermark("chart", block)} className="" /></div>
          </div>
          <div className="token-terminal-sidebar">
            <TradeSheetSurface>
              <div className="terminal-trade"><TokenTrading tokenAddress={address} symbol={token.symbol} tokenImageURL={token.image_url} creator={token.creator as `0x${string}`} tokenPriceWei={liveMetrics.current_price} graduated={graduated} canonicalPoolAddress={(token.graduation?.canonical_pool_address || token.curve?.canonical_pool_address) as `0x${string}` | undefined} /></div>
            </TradeSheetSurface>
          </div>
          <div className="token-terminal-support" data-mobile-section={mobileSection}>
            <aside className="terminal-market"><MarketOverview token={liveToken} onchain={onchain} /></aside>
            <aside className="terminal-graduation"><TokenGraduation token={token} /></aside>
            <aside className="terminal-cto"><TokenCTO tokenAddress={address} /></aside>
          </div>
        </div>
        <div className="token-terminal-history" data-mobile-section={mobileSection}><TokenTradeHistory tokenAddress={address} symbol={token.symbol} provisional={realtime} onIndexedThroughBlock={(block) => observeWatermark("trades", block)} /></div>
      </div>

      <section className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]" data-mobile-section={mobileSection === "about" ? "about" : "hidden"}>
        <article className="terminal-panel p-5"><p className="eyebrow">About &amp; socials</p><h2 className="mt-2 text-xl font-semibold text-white">{token.name}</h2>{token.description ? <p className="mt-4 text-sm leading-7 text-zinc-300">{token.description}</p> : <p className="mt-4 text-sm text-zinc-500">No about text has been provided.</p>}<div className="mt-5 flex flex-wrap gap-2">{token.website_url && <SocialLink href={token.website_url} label="Website" />}{token.x_url && <SocialLink href={token.x_url} label="X / Twitter" />}{token.telegram_url && <SocialLink href={token.telegram_url} label="Telegram" />}{token.discord_url && <SocialLink href={token.discord_url} label="Discord" />}{!token.website_url && !token.x_url && !token.telegram_url && !token.discord_url && <span className="text-xs text-zinc-600">No social links provided.</span>}</div><div className="mt-6 border-t border-white/8 pt-4"><p className="text-xs text-zinc-600">Creator</p><Link className="address mt-1 block text-cyan-300 hover:text-cyan-200" href={`/creator/${token.creator}`}>{token.creator}</Link></div></article>
        <article className="terminal-panel p-5"><p className="eyebrow">Holders</p><p className="mt-3 text-3xl font-semibold text-white">{formatCount(token.metrics.holder_count)}</p><p className="mt-2 text-sm leading-6 text-zinc-500">Canonical holder count from indexed ERC-20 transfers.</p><div className="status-box mt-5 text-xs text-zinc-500">Holder distribution is unavailable in the current API.</div></article>
      </section>

      <div data-mobile-section={mobileSection === "activity" ? "activity" : "hidden"}>
        <TokenActivity tokenAddress={address} />
        <section className="terminal-panel mt-10 p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Provenance</p><h2 className="section-heading mt-2">Canonical launch record</h2></div><span className="badge-neutral">{selectedCooketChainName} · {selectedCooketChainId}</span></div><dl className="mt-6 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3"><Detail label="Token contract" value={token.address} link={explorerAddressURL(token.address)} /><Detail label="Curve contract" value={token.curve?.address ?? "Not indexed"} link={token.curve?.address ? explorerAddressURL(token.curve.address) : undefined} /><Detail label="Created at block" value={String(token.created_at.block_number)} /><Detail label="Initial supply" value={formatTokenAmount(token.initial_supply, 18, token.symbol)} /><Detail label="Onchain read" value={onchain ?? "Checking…"} /><Detail label="Launch transaction" value={token.created_at.transaction_hash} link={explorerTransactionURL(token.created_at.transaction_hash)} /></dl></section>
      </div>
      <p className="mt-6 text-center text-xs text-zinc-600">{selectedCooketChainName} market values use a common dollar display.</p>
      <MobileTradeActions symbol={token.symbol} />
    </main>
  </TokenTradeSheetProvider>;
}

function CopyableAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const short = address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard may be unavailable */ }
  };
  return <button type="button" className="address mt-1 inline-flex min-h-11 items-center gap-2 text-left" title={address} aria-label={copied ? "Token address copied" : "Copy token address"} onClick={() => void copy()}>
    <span>{short}</span>
    <span className="text-[0.65rem] font-semibold text-cyan-300">{copied ? "Copied" : "Copy"}</span>
  </button>;
}

function MarketOverview({ token, onchain }: { token: Token; onchain: string | null }) { const graduated = isGraduatedToken(token); return <section className="terminal-panel"><div className="border-b border-white/8 p-4"><h2 className="font-semibold text-white">Market overview</h2><p className="mt-1 text-[0.65rem] text-zinc-600">Dollar-denominated market values</p></div><dl className="grid grid-cols-2 gap-px bg-white/6"><MarketStat label="Price" value={formatPrice(token.metrics.current_price)} title={formatExactUSDC(token.metrics.current_price)} secondary="Per token" /><MarketStat label="FDV" value={formatMarketUSDC(token.metrics.fully_diluted_value)} title={formatExactUSDC(token.metrics.fully_diluted_value)} secondary="Market value" /><MarketStat label="Volume" value={formatMarketUSDC(token.metrics.volume)} title={formatExactUSDC(token.metrics.volume)} secondary="Cumulative trading" />{graduated ? <MarketStat label="LP custody" value={hasIndexedSettlement(token) ? "Legacy reference" : "Unavailable"} secondary="Arc Testnet market" /> : <MarketStat label="Curve reserve" value={formatMarketUSDC(token.curve?.reserve_balance)} title={formatExactUSDC(token.curve?.reserve_balance)} secondary="Market reserve" />}<MarketStat label="Trades" value={formatCount(token.metrics.trade_count)} secondary={`${formatCount(token.metrics.unique_trader_count)} traders`} /><MarketStat label="Holders" value={formatCount(token.metrics.holder_count)} secondary={onchain ?? "Checking onchain"} /></dl></section>; }
function MarketStat({ label, value, title, secondary }: { label: string; value: string; title?: string; secondary: string }) { return <div className="min-w-0 bg-[#0d1322] p-3"><dt className="text-[0.68rem] text-zinc-600">{label}</dt><dd className="mt-1 truncate text-sm font-semibold text-zinc-100" title={title ?? value}>{value}</dd><dd className="mt-0.5 truncate text-[0.65rem] text-zinc-600" title={secondary}>{secondary}</dd></div>; }
function TopMetric({ label, value, title }: { label: string; value: string; title?: string }) { return <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3"><p className="text-[0.65rem] text-zinc-600">{label}</p><p className="mt-1 truncate text-sm font-semibold text-zinc-100" title={title ?? value}>{value}</p></div>; }

function Detail({ label, value, link }: { label: string; value: string; link?: string }) { return <div className="min-w-0"><dt className="text-zinc-500">{label}</dt><dd className="address mt-1 text-zinc-200">{link ? <a className="text-cyan-300 hover:text-cyan-200" href={link} target="_blank" rel="noreferrer">{value} ↗</a> : value}</dd></div>; }
function SocialLink({ href, label }: { href: string; label: string }) { return <a className="button-secondary min-h-11 px-3 text-xs" href={href} target="_blank" rel="noreferrer">{label} ↗</a>; }
function PageState({ title, copy, action }: { title: string; copy: string; action?: () => void }) { return <main className="container page-shell flex-1"><div className="status-box status-error max-w-2xl py-8"><h1 className="text-lg font-semibold">{title}</h1><p className="mt-2 text-sm opacity-80">{copy}</p>{action && <button className="button-secondary mt-5" type="button" onClick={action}>Try again</button>}</div></main>; }
function lifecycleBadge(phase?: string, hasCurve?: boolean) { const value = phase?.toLowerCase(); if (value && /graduated|settled|complete/.test(value)) return { label: "Graduated", className: "badge-violet" }; if (value && /pending|graduat|settling/.test(value)) return { label: "Graduating", className: "badge-warning" }; return hasCurve ? { label: "Active curve", className: "badge-success" } : null; }
