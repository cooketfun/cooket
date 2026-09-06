"use client";

import { api } from "@/lib/api";
import { WalletProfileContent } from "@/components/wallet-profile-content";
import { activeWalletStatusMessage, useActiveWallet } from "@/providers/active-wallet-provider";
import { creatorProfileQueryKey } from "@/lib/canonical-queries";

export default function ProfilePage() {
  return <main className="container page-shell flex-1"><p className="eyebrow">Creator dashboard</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">Your indexed activity</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">Review launches associated with your connected browser wallet.</p><BrowserWalletProfile /></main>;
}

function BrowserWalletProfile() {
  const { connected, ready, status, activeAddress: address } = useActiveWallet();
  if (!ready || status === "sdk_not_ready" || status === "wallet_loading") return <div className="status-box mt-8 max-w-xl text-zinc-400" role="status">{activeWalletStatusMessage(status)}</div>;
  if (!connected || !address) return <div className="status-box mt-8 max-w-xl text-zinc-400">{activeWalletStatusMessage(status)}</div>;
  return <div className="mt-8"><section className="panel-subtle p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><span className="badge-success">Browser wallet</span><span className="badge-neutral">Active profile</span></div><p className="address mt-3 text-zinc-300">{address}</p></section><WalletProfileContent address={address} surface="creator" createdLimit={12} /></div>;
}

export function activeProfileQueryKey(address?: string) {
  return creatorProfileQueryKey("creator", address);
}

export function loadActiveProfile(address: string) {
  return api.creator(address, "?limit=12");
}
