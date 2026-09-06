"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { TokenCard, TopTokenCard } from "@/components/token-card";
import { CursorPagination, useCursorPagination } from "@/components/cursor-pagination";
import { HorizontalCarousel } from "@/components/horizontal-carousel";

const filters = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "top", label: "Top" },
  { id: "near", label: "Near Graduation" },
  { id: "linked", label: "Linked X" },
] as const;

type FilterId = typeof filters[number]["id"];
type ViewMode = "grid" | "list";
const LAUNCH_PAGE_SIZE = 12;

export function DiscoveryMarketplace() {
  const [filter, setFilter] = useState<FilterId>("trending");
  const [view, setView] = useState<ViewMode>("grid");
  const top = useQuery({ queryKey: ["discovery-top-tokens"], queryFn: () => api.trending("?limit=12") });

  return <>
    <section className="mt-7" aria-labelledby="top-tokens-heading">
      <SectionHeading eyebrow="Market leaders" title="Top Tokens" id="top-tokens-heading" copy="Canonical 24-hour activity ranking from the Cooket index." />
      <HorizontalCarousel label="Top indexed tokens" className="mt-2">
        {top.isPending && Array.from({ length: 4 }, (_, index) => <TopTokenSkeleton key={index} />)}
        {top.isError && <div className="status-box status-error min-w-full"><div className="flex items-center justify-between gap-3"><span>Top tokens could not be loaded.</span><button type="button" className="button-secondary" onClick={() => void top.refetch()}>Try again</button></div></div>}
        {top.data?.items.length === 0 && <div className="status-box min-w-full text-zinc-400">No indexed market leaders yet.</div>}
        {top.data?.items.map((token, index) => <TopTokenCard key={token.address} token={token} rank={index + 1} />)}
      </HorizontalCarousel>
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

      <LaunchResults key={filter} filter={filter} view={view} />
    </section>
  </>;
}

function LaunchResults({ filter, view }: { filter: FilterId; view: ViewMode }) {
  const pagination = useCursorPagination();
  const query = pagination.cursor ? `&cursor=${encodeURIComponent(pagination.cursor)}` : "";
  const launches = useQuery({
    queryKey: ["discovery-launches", filter, pagination.cursor],
    queryFn: () => filter === "trending"
      ? api.trending(`?limit=${LAUNCH_PAGE_SIZE}${query}`)
      : api.listTokens(`?limit=${LAUNCH_PAGE_SIZE}&view=${filter}${query}`),
  });
  const { discoverNext } = pagination;
  useEffect(() => { if (launches.data) discoverNext(launches.data.next_cursor); }, [discoverNext, launches.data]);
  const items = launches.data?.items ?? [];
  return <div className="mt-4" aria-live="polite">
    {launches.isPending && <LaunchSkeletons view={view} />}
    {launches.isError && <div className="status-box status-error flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"><span>Launches could not be loaded. {launches.error.message}</span><button className="button-secondary" type="button" onClick={() => void launches.refetch()}>Try again</button></div>}
    {!launches.isPending && !launches.isError && items.length === 0 && <div className="status-box py-10 text-center"><p className="font-medium text-zinc-200">No launches in this view</p><p className="mt-2 text-sm text-zinc-500">Confirmed launches will appear here when matching indexed data is available.</p></div>}
    {items.length > 0 && <div className={view === "grid" ? "token-market-grid" : "grid gap-2"}>{items.map((token) => <TokenCard key={token.address} token={token} variant={view} />)}</div>}
    <CursorPagination currentPage={pagination.currentPage} pageCount={pagination.pageCount} hasUnknownPages={pagination.hasUnknownPages} onPageChange={pagination.goToPage} label={`${filters.find((item) => item.id === filter)?.label ?? "Launch"} launch pages`} disabled={launches.isPending} />
  </div>;
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
