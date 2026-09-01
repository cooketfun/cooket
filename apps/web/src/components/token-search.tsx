"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { TokenCard } from "@/components/token-card";

export function TokenSearch() {
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["token-search", search], queryFn: () => api.listTokens(`?search=${encodeURIComponent(search)}&limit=12`), enabled: search.trim().length > 0 });
  return <section className="mt-16 rounded-[1.25rem] border border-cyan-300/12 bg-cyan-300/[0.025] p-4 sm:p-6" aria-label="Token search">
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="eyebrow">Token directory</p><label className="mt-2 block text-lg font-semibold text-white" htmlFor="token-search">Find a token</label><p className="mt-1 text-sm text-zinc-500">Search by indexed name, symbol, or address prefix.</p></div><span className="badge-neutral w-fit">Canonical index</span></div>
    <div className="relative mt-4">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" aria-hidden>⌕</span>
      <input id="token-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={64} className="pl-11 pr-20" autoComplete="off" placeholder="Name, symbol, or 0x address" />
      {search && <button className="button-ghost absolute right-1 top-1/2 min-h-10 -translate-y-1/2 px-3" type="button" onClick={() => setSearch("")} aria-label="Clear token search">Clear</button>}
    </div>
    {search.trim() && <div className="mt-5" aria-live="polite">
      {query.isPending && <p className="status-box text-zinc-400">Searching indexed tokens…</p>}
      {query.isError && <p className="status-box status-error">Search results could not be loaded.</p>}
      {query.data?.items.length === 0 && <p className="status-box text-zinc-400">No indexed tokens match “{search.trim()}”.</p>}
      {query.data && query.data.items.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data.items.map((token) => <TokenCard key={token.address} token={token} />)}</div>}
    </div>}
  </section>;
}
