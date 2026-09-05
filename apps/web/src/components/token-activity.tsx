"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { explorerTransactionURL } from "@/lib/chain";

export function TokenActivity({ tokenAddress }: { tokenAddress: string }) {
  const query = useQuery({ queryKey: ["token-activity", tokenAddress], queryFn: () => api.activity(tokenAddress, "?limit=20"), refetchInterval: 15_000 });
  return <section className="panel mt-10 min-w-0" aria-label="Token activity"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Ledger</p><h2 className="section-heading mt-2">Token activity</h2><p className="section-copy">Launches, trades, and token transfers.</p></div><span className="badge-neutral w-fit">Activity</span></div>{query.isPending && <div className="mt-5 grid gap-3">{Array.from({ length: 3 }, (_, index) => <div className="skeleton h-16 rounded-xl" key={index} />)}</div>}{query.isError && <p className="status-box status-error mt-5">Token activity could not be loaded.</p>}{query.data?.items.length === 0 && <p className="status-box mt-5 text-zinc-400">No activity yet.</p>}{query.data && query.data.items.length > 0 && <ul className="mt-5 grid gap-2">{query.data.items.map((event) => <li key={`${event.transaction_hash}:${event.log_index}`} className="rounded-xl border border-white/8 bg-black/15 p-3 text-sm sm:p-4"><div className="flex flex-col gap-2 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between"><span className="font-medium text-zinc-200">{event.event_name}</span><span className="font-mono text-xs text-zinc-500">Block {event.block_number}</span></div><a className="mt-2 inline-flex min-h-11 items-center text-cyan-300 hover:text-cyan-200" href={explorerTransactionURL(event.transaction_hash)} target="_blank" rel="noreferrer">View on ArcScan ↗</a></li>)}</ul>}</section>;
}
