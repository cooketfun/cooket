"use client";

import { useQuery } from "@tanstack/react-query";
import type { CTOCheckpointPage, CTOFeePull, CTOProposal, CTOStatus, CTOTreasury, CTOTreasuryTransfer } from "@cooket/types";
import { api } from "@/lib/api";
import { explorerAddressURL, explorerTransactionURL } from "@/lib/chain";

export function TokenCTO({ tokenAddress }: { tokenAddress: string }) {
  const statusQuery = useQuery({ queryKey: ["cto-status", tokenAddress], queryFn: () => api.ctoStatus(tokenAddress) });
  const status = statusQuery.data;
  const proposalsQuery = useQuery({ queryKey: ["cto-proposals", tokenAddress], queryFn: () => api.ctoProposals(tokenAddress, "?limit=20"), enabled: statusQuery.isSuccess });
  const checkpointsQuery = useQuery({ queryKey: ["cto-checkpoints", tokenAddress], queryFn: () => api.ctoCheckpoints(tokenAddress, "?limit=20"), enabled: statusQuery.isSuccess });
  const proposalQuery = useQuery({ queryKey: ["cto-proposal", status?.active_proposal_id], queryFn: () => api.ctoProposal(status!.active_proposal_id!), enabled: Boolean(status?.active && status.active_proposal_id) });
  const treasuryQuery = useQuery({ queryKey: ["cto-treasury", status?.treasury], queryFn: () => api.ctoTreasury(status!.treasury!), enabled: Boolean(status?.treasury) });
  const transfersQuery = useQuery({ queryKey: ["cto-transfers", status?.treasury], queryFn: () => api.ctoTreasuryTransfers(status!.treasury!, "?limit=20"), enabled: Boolean(status?.treasury) });
  const feePullsQuery = useQuery({ queryKey: ["cto-fee-pulls", status?.treasury], queryFn: () => api.ctoTreasuryFeePulls(status!.treasury!, "?limit=20"), enabled: Boolean(status?.treasury) });

  return <section className="terminal-panel overflow-hidden" aria-label="Community takeover status">
    <div className="border-b border-white/8 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow">Community takeover</p><h2 className="mt-1 text-lg font-semibold text-white">CTO</h2></div>
        <StatusBadge status={status} pending={statusQuery.isPending} failed={statusQuery.isError} />
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-400">Read-only indexed CTO data. This page does not submit transactions or fetch proposal metadata.</p>
    </div>
    <div className="p-4">
      {statusQuery.isPending && <div className="skeleton h-16 rounded-xl" />}
      {statusQuery.isError && <div className="status-box status-error text-sm">CTO status could not be loaded.</div>}
      {status && !status.active && <InactiveCTO />}
      {status?.active && <ActiveCTO status={status} proposal={proposalQuery.data} treasury={treasuryQuery.data} />}
      {proposalQuery.isError && <div className="status-box status-error mt-4 text-sm">Active proposal could not be loaded.</div>}
      {treasuryQuery.isError && <div className="status-box status-error mt-4 text-sm">Treasury could not be loaded.</div>}
      {transfersQuery.data && <TransferList items={transfersQuery.data.items} nextCursor={transfersQuery.data.next_cursor} />}
      {feePullsQuery.data && <FeePullList items={feePullsQuery.data.items} nextCursor={feePullsQuery.data.next_cursor} />}
      {checkpointsQuery.data && <CheckpointList page={checkpointsQuery.data} />}
      {proposalsQuery.data && <ProposalList items={proposalsQuery.data.items} nextCursor={proposalsQuery.data.next_cursor} />}
    </div>
  </section>;
}

function StatusBadge({ status, pending, failed }: { status?: CTOStatus; pending: boolean; failed: boolean }) {
  if (pending) return <span className="badge-neutral">Loading</span>;
  if (failed) return <span className="badge-warning">Unavailable</span>;
  return <span className={status?.active ? "badge-success" : "badge-neutral"}>{status?.active ? "Active" : "Not active"}</span>;
}

function InactiveCTO() {
  return <div className="status-box text-sm text-zinc-400">No community takeover is active for this token.</div>;
}

function ActiveCTO({ status, proposal, treasury }: { status: CTOStatus; proposal?: CTOProposal; treasury?: CTOTreasury }) {
  return <div className="grid gap-4">
    <dl className="grid gap-3 text-sm">
      {status.registry && <CTODetail label="Registry" value={status.registry} href={explorerAddressURL(status.registry)} />}
      {status.treasury && <CTODetail label="Treasury" value={status.treasury} href={explorerAddressURL(status.treasury)} />}
      {status.controller && <CTODetail label="Controller" value={status.controller} href={explorerAddressURL(status.controller)} />}
      {status.previous_recipient && <CTODetail label="Previous recipient" value={status.previous_recipient} href={explorerAddressURL(status.previous_recipient)} />}
      {status.active_proposal_id && <CTODetail label="Active proposal" value={status.active_proposal_id} />}
      {status.activation && <CTODetail label="Activation" value={status.activation.transaction_hash} href={explorerTransactionURL(status.activation.transaction_hash)} />}
    </dl>
    {proposal && <ProposalCard proposal={proposal} />}
    {treasury && <TreasuryCard treasury={treasury} />}
  </div>;
}

function ProposalCard({ proposal }: { proposal: CTOProposal }) {
  return <div className="rounded-xl border border-white/8 bg-black/20 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-white">Proposal</p><span className="badge-neutral">{proposal.state}</span></div>
    <dl className="mt-3 grid gap-2 text-sm">
      <CTODetail label="Proposal ID" value={proposal.proposal_id} />
      <CTODetail label="Nonce" value={proposal.nonce} />
      <CTODetail label="Metadata hash" value={proposal.metadata_hash} />
      <div className="min-w-0"><dt className="text-zinc-600">Metadata URI</dt><MetadataURI value={proposal.metadata_uri} /></div>
    </dl>
  </div>;
}

function TreasuryCard({ treasury }: { treasury: CTOTreasury }) {
  return <div className="rounded-xl border border-white/8 bg-black/20 p-3">
    <p className="text-sm font-semibold text-white">Treasury</p>
    <dl className="mt-3 grid gap-2 text-sm">
      <CTODetail label="Nonce" value={treasury.nonce} />
      {treasury.canonical_usdc && <CTODetail label="Canonical USDC" value={treasury.canonical_usdc} href={explorerAddressURL(treasury.canonical_usdc)} />}
      <CTODetail label="Deployment" value={treasury.deployment.transaction_hash} href={explorerTransactionURL(treasury.deployment.transaction_hash)} />
    </dl>
    {treasury.supported_assets.length > 0 && <ul className="mt-3 grid gap-1 text-xs text-zinc-500">{treasury.supported_assets.map((asset) => <li key={`${asset.asset}:${asset.registered.transaction_hash}:${asset.registered.log_index}`} className="address break-all">Asset {asset.asset}</li>)}</ul>}
  </div>;
}

function ProposalList({ items, nextCursor }: { items: CTOProposal[]; nextCursor?: string }) {
  if (items.length === 0) return null;
  return <div className="mt-4 border-t border-white/8 pt-4">
    <h3 className="text-sm font-semibold text-white">Proposal history</h3>
    <ul className="mt-3 grid gap-2">{items.map((item) => <li key={item.proposal_id} className="rounded-xl border border-white/8 bg-black/15 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="badge-neutral">{item.state}</span><span className="font-mono text-xs text-zinc-500">nonce {item.nonce}</span></div>
      <p className="address mt-2 break-all text-zinc-300">{item.proposal_id}</p>
      <div className="mt-2"><dt className="text-xs text-zinc-600">Metadata URI</dt><MetadataURI value={item.metadata_uri} /></div>
    </li>)}</ul>
    {nextCursor && <p className="mt-2 text-xs text-zinc-600">More indexed proposals are available through the next cursor.</p>}
  </div>;
}

function TransferList({ items, nextCursor }: { items: CTOTreasuryTransfer[]; nextCursor?: string }) {
  if (items.length === 0) return null;
  return <div className="mt-4 border-t border-white/8 pt-4">
    <h3 className="text-sm font-semibold text-white">Treasury transfers</h3>
    <ul className="mt-3 grid gap-2">{items.map((item) => <li key={`${item.provenance.transaction_hash}:${item.provenance.log_index}`} className="rounded-xl border border-white/8 bg-black/15 p-3 text-sm">
      <p className="font-mono text-zinc-200" title={item.amount}>{formatExactInteger(item.amount)}</p>
      <p className="address mt-1 break-all text-zinc-500">to {item.recipient}</p>
      <a className="mt-2 inline-flex min-h-11 items-center text-xs text-cyan-300 hover:text-cyan-200" href={explorerTransactionURL(item.provenance.transaction_hash)} target="_blank" rel="noreferrer">Transfer transaction ↗</a>
    </li>)}</ul>
    {nextCursor && <p className="mt-2 text-xs text-zinc-600">More indexed transfers are available through the next cursor.</p>}
  </div>;
}

function FeePullList({ items, nextCursor }: { items: CTOFeePull[]; nextCursor?: string }) {
  if (items.length === 0) return null;
  return <div className="mt-4 border-t border-white/8 pt-4">
    <h3 className="text-sm font-semibold text-white">Fee pulls</h3>
    <ul className="mt-3 grid gap-2">{items.map((item) => <li key={`${item.provenance.transaction_hash}:${item.provenance.log_index}`} className="rounded-xl border border-white/8 bg-black/15 p-3 text-sm">
      <p className="font-mono text-zinc-200" title={item.amount}>{formatExactInteger(item.amount)}</p>
      <p className="address mt-1 break-all text-zinc-500">asset {item.asset}</p>
      <a className="mt-2 inline-flex min-h-11 items-center text-xs text-cyan-300 hover:text-cyan-200" href={explorerTransactionURL(item.provenance.transaction_hash)} target="_blank" rel="noreferrer">Fee-pull transaction ↗</a>
    </li>)}</ul>
    {nextCursor && <p className="mt-2 text-xs text-zinc-600">More indexed fee pulls are available through the next cursor.</p>}
  </div>;
}

function CheckpointList({ page }: { page: CTOCheckpointPage }) {
  if (page.aggregates.length === 0 && page.items.length === 0) return null;
  return <div className="mt-4 border-t border-white/8 pt-4">
    <h3 className="text-sm font-semibold text-white">Creator-fee checkpoints</h3>
    {page.aggregates.length > 0 && <ul className="mt-3 grid gap-2">{page.aggregates.map((item) => <li key={item.recipient} className="rounded-xl border border-white/8 bg-black/15 p-3 text-sm">
      <p className="address break-all text-zinc-300">{item.recipient}</p>
      <p className="mt-1 font-mono text-xs text-zinc-500" title={`${item.checkpointed}/${item.claimed}/${item.outstanding}`}>checkpointed {formatExactInteger(item.checkpointed)} · claimed {formatExactInteger(item.claimed)} · outstanding {formatExactInteger(item.outstanding)}</p>
    </li>)}</ul>}
    {page.next_cursor && <p className="mt-2 text-xs text-zinc-600">More indexed checkpoints are available through the next cursor.</p>}
  </div>;
}

function MetadataURI({ value }: { value: string }) {
  return <p className="address mt-1 break-all whitespace-pre-wrap text-zinc-300" data-testid="cto-metadata-uri">{value || "None"}</p>;
}

function CTODetail({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="grid min-w-0 gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]"><dt className="text-zinc-600">{label}</dt><dd className="address min-w-0 break-all text-zinc-200">{href ? <a className="text-cyan-300 hover:text-cyan-200" href={href} target="_blank" rel="noreferrer">{value} ↗</a> : value}</dd></div>;
}

function formatExactInteger(value: string) {
  try { return BigInt(value).toLocaleString("en-US"); }
  catch { return value; }
}
