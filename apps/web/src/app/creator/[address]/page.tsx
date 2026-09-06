"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { WalletProfileContent } from "@/components/wallet-profile-content";
import { selectedCooketChainName, validAddress } from "@/lib/chain";

export default function CreatorPage() {
  const { address } = useParams<{ address: string }>();
  const valid = validAddress(address);
  if (!valid) return <main className="container page-shell flex-1"><div className="status-box status-error">Invalid creator address.</div></main>;
  return <main className="container page-shell flex-1">
    <Link href="/" className="inline-flex min-h-10 items-center text-sm text-zinc-500 hover:text-cyan-200">←&nbsp; Back to explore</Link>
    <section className="mt-3 rounded-[1.35rem] border border-white/10 bg-[#0d1322]/80 p-5 sm:p-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/8 text-xl font-semibold text-violet-200" aria-hidden>{address.slice(2, 4).toUpperCase()}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="eyebrow">Public wallet</p><span className="badge-violet">{selectedCooketChainName}</span></div><h1 className="address mt-3 text-sm text-zinc-200 sm:text-base">{address}</h1></div></div></section>
    <WalletProfileContent address={address} surface="public-creator" createdLimit={24} />
  </main>;
}
