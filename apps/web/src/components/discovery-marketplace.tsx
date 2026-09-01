"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Token } from "@cooket/types";
import { api } from "@/lib/api";
import { graduationProgress } from "@/lib/format";
import { TokenCard, TopTokenCard } from "@/components/token-card";

const filters = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "top", label: "Top" },
  { id: "near", label: "Near Graduation" },
  { id: "linked", label: "Linked X" },
] as const;

type FilterId = typeof filters[number]["id"];
type ViewMode = "grid" | "list";

export function DiscoveryMarketplace() {
  const [filter, setFilter] = useState<FilterId>("trending");
  const [view, setView] = useState<ViewMode>("grid");
  const top = useQuery({ queryKey: ["discovery-top-tokens"], queryFn: () => api.trending("?limit=12") });
  const launches = useQuery({
    queryKey: ["discovery-launches", filter],
    queryFn: () => filter === "trending" ? api.trending("?limit=48") : api.listTokens("?limit=48"),
  });
  const items = useMemo(() => arrangeTokens(launches.data?.items ?? [], filter), [launches.data?.items, filter]);

  return <>
    <section className="mt-7" aria-labelledby="top-tokens-heading">
      <SectionHeading eyebrow="Market leaders" title="Top Tokens" id="top-tokens-heading" copy="Canonical 24-hour activity ranking from the Cooket index." />
      <div className="market-rail mt-4" aria-label="Top indexed tokens">
        {top.isPending && Array.from({ length: 4 }, (_, index) => <TopTokenSkeleton key={index} />)}
        {top.isError && <div className="status-box status-error min-w-full"><div className="flex items-center justify-between gap-3"><span>Top tokens could not be loaded.</span><button type="button" className="button-secondary" onClick={() => void top.refetch()}>Try again</button></div></div>}
        {top.data?.items.length === 0 && <div className="status-box min-w-full text-zinc-400">No indexed market leaders yet.</div>}
        {top.data?.items.map((token, index) => <TopTokenCard key={token.address} token={token} rank={index + 1} />)}
      </div>
    </section>

    <section id="all-launches" className="mt-9 scroll-mt-28" aria-labelledby="all-launches-heading">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading eyebrow="Discovery" title="All Launches" id="all-launches-heading" copy="Browse live API-backed launches without leaving the market." />
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <div className="safe-scroll -mx-1 flex min-w-0 gap-1 px-1 pb-1" role="tablist" aria-label="Filter launches">
            {filters.map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`market-filter min-h-11 ${filter === item.id ? "market-filter-active" : ""}`} onClick={() => setFilter(item.id)}>{item.label}</button>)}
          </div>
          <div className="flex flex-none items-center rounded-lg border border-white/10 bg-black/20 p-1" aria-label="Launch view">
            <ViewButton label="Grid view" active={view === "grid"} onClick={() => setView("grid")}>▦</ViewButton>
            <ViewButton label="List view" active={view === "list"} onClick={() => setView("list")}>☷</ViewButton>
          </div>
        </div>
      </div>

      <div className="mt-4" aria-live="polite">
        {launches.isPending && <LaunchSkeletons view={view} />}
        {launches.isError && <div className="status-box status-error flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"><span>Launches could not be loaded. {launches.error.message}</span><button className="button-secondary" type="button" onClick={() => void launches.refetch()}>Try again</button></div>}
        {!launches.isPending && !launches.isError && items.length === 0 && <div className="status-box py-10 text-center"><p className="font-medium text-zinc-200">No launches in this view</p><p className="mt-2 text-sm text-zinc-500">Confirmed launches will appear here when matching indexed data is available.</p></div>}
        {items.length > 0 && <div className={view === "grid" ? "token-market-grid" : "grid gap-2"}>{items.map((token) => <TokenCard key={token.address} token={token} variant={view} />)}</div>}
      </div>
    </section>
  </>;
}

function arrangeTokens(items: Token[], filter: FilterId) {
  if (filter === "linked") return items.filter((token) => Boolean(token.x_url));
  if (filter === "near") return [...items].filter((token) => graduationProgress(token.curve?.sold_supply, token.curve?.graduation_threshold) !== null).sort((a, b) => progressOf(b) - progressOf(a));
  if (filter === "top") return [...items].sort((a, b) => compareIntegerStrings(b.metrics.fully_diluted_value, a.metrics.fully_diluted_value));
  return items;
}

function progressOf(token: Token) {
  return graduationProgress(token.curve?.sold_supply, token.curve?.graduation_threshold) ?? -1;
}

function compareIntegerStrings(left: string | null, right: string | null) {
  try {
    const difference = BigInt(left ?? 0) - BigInt(right ?? 0);
    return difference > 0 ? 1 : difference < 0 ? -1 : 0;
  } catch { return 0; }
}

function SectionHeading({ eyebrow, title, id, copy }: { eyebrow: string; title: string; id: string; copy: string }) {
  return <div><p className="eyebrow">{eyebrow}</p><h2 id={id} className="mt-1.5 text-xl font-semibold tracking-[-0.025em] text-white sm:text-2xl">{title}</h2><p className="mt-1 text-sm text-zinc-500">{copy}</p></div>;
}

function ViewButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: string }) {
  return <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`flex h-8 w-8 items-center justify-center rounded-md text-base transition-colors ${active ? "bg-cyan-300/12 text-cyan-200" : "text-zinc-600 hover:text-zinc-300"}`}>{children}</button>;
}

function TopTokenSkeleton() {
  return <div className="top-token-card"><div className="skeleton h-16 w-16 flex-none rounded-xl" /><div className="min-w-0 flex-1"><div className="skeleton h-4 w-2/3 rounded" /><div className="skeleton mt-3 h-3 w-1/2 rounded" /><div className="skeleton mt-4 h-3 w-full rounded" /></div></div>;
}

function LaunchSkeletons({ view }: { view: ViewMode }) {
  return <div className={view === "grid" ? "token-market-grid" : "grid gap-2"} aria-label="Loading indexed launches">{Array.from({ length: view === "grid" ? 10 : 5 }, (_, index) => <div key={index} className={view === "grid" ? "market-card min-h-72" : "market-card h-24"}><div className="skeleton aspect-[4/3] w-full rounded-lg" /></div>)}</div>;
}
