"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api, apiAssetURL } from "@/lib/api";

export function HeaderTokenSearch({ id = "global-token-search", autoFocus = false, onNavigate }: { id?: string; autoFocus?: boolean; onNavigate?: () => void }) {
  const [search, setSearch] = useState("");
  const term = search.trim();
  const query = useQuery({
    queryKey: ["header-token-search", term],
    queryFn: () => api.listTokens(`?search=${encodeURIComponent(term)}&limit=6`),
    enabled: term.length > 0,
  });

  return <div className="relative w-full" role="search">
    <label className="sr-only" htmlFor={id}>Search tokens</label>
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-600" aria-hidden>⌕</span>
    <input
      id={id}
      type="search"
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      maxLength={64}
      autoComplete="off"
      autoFocus={autoFocus}
      placeholder="Search name, symbol, or address"
      className="header-search-input pl-9"
      role="combobox"
      aria-controls={term ? `${id}-results` : undefined}
      aria-expanded={term ? true : undefined}
    />
    {term && <div id={`${id}-results`} className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 overflow-hidden rounded-xl border border-white/10 bg-[#0d1322] p-1.5 shadow-2xl shadow-black/50" aria-live="polite">
      {query.isPending && <p className="px-3 py-3 text-xs text-zinc-500">Searching indexed tokens…</p>}
      {query.isError && <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-rose-300"><span>Search unavailable</span><button type="button" className="text-cyan-300" onClick={() => void query.refetch()}>Retry</button></div>}
      {query.data?.items.length === 0 && <p className="px-3 py-3 text-xs text-zinc-500">No indexed tokens found.</p>}
      {query.data?.items.map((token) => <Link key={token.address} href={`/token/${token.address}`} onClick={() => { setSearch(""); onNavigate?.(); }} className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/5">
        <TokenThumb image={token.image_url} symbol={token.symbol} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{token.name}</span><span className="block truncate text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-cyan-300">{token.symbol}</span></span>
        <span className="text-xs text-zinc-600" aria-hidden>→</span>
      </Link>)}
    </div>}
  </div>;
}

function TokenThumb({ image, symbol }: { image?: string; symbol: string }) {
  return image
    ? <span aria-hidden className="h-8 w-8 flex-none rounded-lg border border-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${apiAssetURL(image)})` }} />
    : <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-cyan-300/15 bg-cyan-300/10 text-xs font-bold text-cyan-200">{symbol.slice(0, 1)}</span>;
}
