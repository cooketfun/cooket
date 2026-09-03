"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TokenCard } from "@/components/token-card";
import { activeWalletStatusMessage, useActiveWallet } from "@/providers/active-wallet-provider";
import { formatNative } from "@/lib/format";

export default function ProfilePage() {
  return <main className="container page-shell flex-1"><p className="eyebrow">Creator dashboard</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">Your indexed activity</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">Review launches associated with your connected browser wallet.</p><BrowserWalletProfile /></main>;
}

function BrowserWalletProfile() {
  const { connected, ready, status, activeAddress: address } = useActiveWallet();
  const query = useQuery({ queryKey: activeProfileQueryKey(address), queryFn: () => loadActiveProfile(address!), enabled: connected && Boolean(address) });
  if (!ready || status === "sdk_not_ready" || status === "wallet_loading") return <div className="status-box mt-8 max-w-xl text-zinc-400" role="status">{activeWalletStatusMessage(status)}</div>;
  if (!connected || !address) return <div className="status-box mt-8 max-w-xl text-zinc-400">{activeWalletStatusMessage(status)}</div>;
  return <div className="mt-8"><section className="panel-subtle p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><span className="badge-success">Browser wallet</span><span className="badge-neutral">Active profile</span></div><p className="address mt-3 text-zinc-300">{address}</p></section><div className="mt-5">{query.isPending ? <div className="grid max-w-xl grid-cols-2 gap-3">{[0, 1].map((value) => <div className="panel h-24" key={value} />)}</div> : query.isError ? <div className="status-box status-error flex flex-col items-start gap-4">{query.error.message}<button className="button-secondary" type="button" onClick={() => void query.refetch()}>Try again</button></div> : <><dl className="grid max-w-xl grid-cols-2 gap-3"><Metric label="Tokens launched" value={String(query.data.token_count)} /><Metric label="Indexed volume" value={formatNative(query.data.volume)} /></dl><section className="mt-10"><p className="eyebrow">Launch history</p><h2 className="section-heading mt-2 mb-5">Created tokens</h2>{query.data.tokens.length === 0 ? <div className="status-box py-8 text-center text-zinc-400">No tokens indexed for this wallet address.</div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data.tokens.map((token) => <TokenCard key={token.address} token={token} />)}</div>}</section></>}</div></div>;
}

function Metric({ label, value, secondary }: { label: string; value: string; secondary?: string }) { return <div className="panel p-4 sm:p-5"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-2 truncate text-xl font-semibold text-white sm:text-2xl" title={value}>{value}</dd>{secondary && <dd className="mt-1 truncate text-xs text-zinc-600">{secondary}</dd>}</div>; }

export function activeProfileQueryKey(address?: string) {
  return ["creator", address] as const;
}

export function loadActiveProfile(address: string) {
  return api.creator(address, "?limit=12");
}
