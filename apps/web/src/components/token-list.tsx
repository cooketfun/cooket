"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TokenCard } from "./token-card";

export function TokenList({ trending = false }: { trending?: boolean }) {
  const query = useQuery({ queryKey: [trending ? "trending" : "tokens"], queryFn: () => trending ? api.trending("?limit=12") : api.listTokens("?limit=12") });
  if (query.isPending) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading indexed tokens">{Array.from({ length: 3 }, (_, index) => <div className="panel h-60" key={index}><div className="skeleton h-12 w-12 rounded-xl" /><div className="skeleton mt-5 h-4 w-2/3 rounded" /><div className="skeleton mt-3 h-3 w-1/2 rounded" /><div className="mt-7 grid grid-cols-2 gap-4"><div className="skeleton h-9 rounded" /><div className="skeleton h-9 rounded" /></div></div>)}</div>;
  if (query.isError) return <div className="status-box status-error flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"><span>{query.error.message}</span><button className="button-secondary" type="button" onClick={() => void query.refetch()}>Try again</button></div>;
  if (query.data.items.length === 0) return <div className="status-box py-8 text-center"><p className="font-medium text-zinc-200">No indexed tokens yet</p><p className="mt-2 text-sm text-zinc-500">New confirmed launches will appear here once indexed.</p></div>;
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data.items.map((token) => <TokenCard key={token.address} token={token} />)}</div>;
}
