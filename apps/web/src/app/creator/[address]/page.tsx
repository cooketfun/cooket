"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TokenCard } from "@/components/token-card";
import { api } from "@/lib/api";
import { selectedCooketChainName, validAddress } from "@/lib/chain";
import { formatNative } from "@/lib/format";

export default function CreatorPage() {
  const { address } = useParams<{ address: string }>();
  const valid = validAddress(address);
  const query = useQuery({ queryKey: ["public-creator", address], queryFn: () => api.creator(address, "?limit=24"), enabled: valid });
  if (!valid) return <main className="container page-shell flex-1"><div className="status-box status-error">Invalid creator address.</div></main>;
  if (query.isPending) return <main className="container page-shell flex-1"><div className="skeleton h-5 w-40 rounded" /><div className="skeleton mt-5 h-20 max-w-2xl rounded-2xl" /><div className="mt-8 grid grid-cols-2 gap-3 sm:max-w-xl">{[0, 1].map((value) => <div className="panel h-24" key={value} />)}</div></main>;
  if (query.isError) return <main className="container page-shell flex-1"><div className="status-box status-error flex flex-col items-start gap-4"><span>Creator profile could not be loaded.</span><button className="button-secondary" type="button" onClick={() => void query.refetch()}>Try again</button></div></main>;
  const creator = query.data;
  return <main className="container page-shell flex-1">
    <Link href="/" className="inline-flex min-h-10 items-center text-sm text-zinc-500 hover:text-cyan-200">←&nbsp; Back to explore</Link>
    <section className="mt-3 rounded-[1.35rem] border border-white/10 bg-[#0d1322]/80 p-5 sm:p-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/8 text-xl font-semibold text-violet-200" aria-hidden>{creator.address.slice(2, 4).toUpperCase()}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="eyebrow">Public creator</p><span className="badge-violet">{selectedCooketChainName}</span></div><h1 className="address mt-3 text-sm text-zinc-200 sm:text-base">{creator.address}</h1></div></div></section>
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:max-w-xl"><Metric label="Tokens launched" value={String(creator.token_count)} /><Metric label="Indexed volume" value={formatNative(creator.volume)} /></dl>
    <section className="mt-10"><div className="mb-5"><p className="eyebrow">Launch history</p><h2 className="section-heading mt-2">Created tokens</h2></div>{creator.tokens.length === 0 ? <div className="status-box py-8 text-center text-zinc-400">No tokens indexed for this creator.</div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{creator.tokens.map((token) => <TokenCard key={token.address} token={token} />)}</div>}</section>
  </main>;
}

function Metric({ label, value, secondary }: { label: string; value: string; secondary?: string }) { return <div className="panel p-4 sm:p-5"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-2 truncate text-xl font-semibold text-white sm:text-2xl" title={value}>{value}</dd>{secondary && <dd className="mt-1 truncate text-xs text-zinc-600">{secondary}</dd>}</div>; }
