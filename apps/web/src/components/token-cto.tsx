"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { CTOCheckpointPage, CTOFeePull, CTOProposal, CTOStatus, CTOTreasury, CTOTreasuryTransfer } from "@cooket/types";
import { getAddress, zeroHash, type Address, type Hex } from "viem";
import { api } from "@/lib/api";
import { explorerAddressURL, explorerTransactionURL } from "@/lib/chain";
import { acceptCTOFromController, buildCTOAcceptancePayload, cancelCTO, CTO_ACCEPTANCE_WINDOW, CTO_EXECUTION_DELAY, CTO_EXECUTION_GRACE_PERIOD, executeCTO, expireCTO, proposeCTO, readCTOChainState, type CTOChainState } from "@/lib/cto-transactions";
import { formatAbsoluteUTC, formatRelativeAge, useUnixNow } from "@/lib/relative-time";
import { activeWalletStatusMessage, useActiveWallet } from "@/providers/active-wallet-provider";

export const CTO_CHAIN_REFRESH_MS = 20_000;
type CurrentState = "inactive" | "proposed" | "accepted" | "cancelled" | "expired" | "active" | "unavailable" | "checking";

function currentState(chainState?: CTOChainState): CurrentState {
  if (!chainState) return "inactive";
  if (chainState.currentProposalId === zeroHash || !chainState.proposal) return "inactive";
  return ({ 1: "proposed", 2: "accepted", 3: "cancelled", 4: "expired", 5: "active" } as Record<number, CurrentState>)[chainState.proposal.state] ?? "unavailable";
}

function timingSensitive(chainState?: CTOChainState) {
  const state = currentState(chainState);
  return state === "proposed" || state === "accepted";
}

export function TokenCTO({ tokenAddress }: { tokenAddress: string }) {
  const wallet = useActiveWallet();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: ["cto-status", tokenAddress], queryFn: () => api.ctoStatus(tokenAddress) });
  const status = statusQuery.data;
  const proposalsQuery = useQuery({ queryKey: ["cto-proposals", tokenAddress], queryFn: () => api.ctoProposals(tokenAddress, "?limit=20"), enabled: statusQuery.isSuccess });
  const onchainQuery = useQuery({
    queryKey: ["cto-onchain", tokenAddress],
    queryFn: () => readCTOChainState(getAddress(tokenAddress)),
    enabled: statusQuery.isSuccess,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => timingSensitive(query.state.data) ? CTO_CHAIN_REFRESH_MS : false,
  });
  const chainState = onchainQuery.data;
  const effectiveState: CurrentState = onchainQuery.isError ? "unavailable" : onchainQuery.isPending ? "checking" : currentState(chainState);
  const indexedCurrentProposal = chainState?.currentProposalId
    ? proposalsQuery.data?.items.find((item) => item.proposal_id.toLowerCase() === chainState.currentProposalId.toLowerCase())
    : undefined;
  const checkpointsQuery = useQuery({ queryKey: ["cto-checkpoints", tokenAddress], queryFn: () => api.ctoCheckpoints(tokenAddress, "?limit=20"), enabled: statusQuery.isSuccess });
  const proposalQuery = useQuery({ queryKey: ["cto-proposal", status?.active_proposal_id], queryFn: () => api.ctoProposal(status!.active_proposal_id!), enabled: Boolean(status?.active && status.active_proposal_id) });
  const treasuryQuery = useQuery({ queryKey: ["cto-treasury", status?.treasury], queryFn: () => api.ctoTreasury(status!.treasury!), enabled: Boolean(status?.treasury) });
  const transfersQuery = useQuery({ queryKey: ["cto-transfers", status?.treasury], queryFn: () => api.ctoTreasuryTransfers(status!.treasury!, "?limit=20"), enabled: Boolean(status?.treasury) });
  const feePullsQuery = useQuery({ queryKey: ["cto-fee-pulls", status?.treasury], queryFn: () => api.ctoTreasuryFeePulls(status!.treasury!, "?limit=20"), enabled: Boolean(status?.treasury) });

  return <section className="terminal-panel overflow-hidden" aria-label="Community takeover status">
    <div className="border-b border-white/8 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow">Community takeover</p><h2 className="mt-1 text-lg font-semibold text-white">CTO</h2></div>
        <StatusBadge state={effectiveState} pending={statusQuery.isPending} failed={statusQuery.isError || onchainQuery.isError} />
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-400">Creator-voluntary community takeover with protocol-enforced acceptance and execution delays.</p>
    </div>
    <div className="p-4">
      {statusQuery.isPending && <div className="skeleton h-16 rounded-xl" />}
      {statusQuery.isError && <div className="status-box status-error text-sm">CTO status could not be loaded.</div>}
      {status && effectiveState === "checking" && <div className="status-box text-sm text-zinc-400">Verifying current CTO state on Arc Testnet…</div>}
      {status && effectiveState === "unavailable" && <div className="status-box status-error mt-4 text-sm">Fresh on-chain CTO state could not be verified. Transaction actions remain unavailable.</div>}
      {status && effectiveState === "inactive" && <InactiveCTO tokenAddress={tokenAddress} chainCreator={chainState?.creator} wallet={wallet} onConfirmed={() => invalidateCTO(queryClient, tokenAddress)} />}
      {status && (effectiveState === "proposed" || effectiveState === "accepted") && chainState?.proposal && <ProposalWorkflow chainState={chainState} indexedProposal={indexedCurrentProposal} wallet={wallet} onConfirmed={() => invalidateCTO(queryClient, tokenAddress, indexedCurrentProposal)} />}
      {status && (effectiveState === "cancelled" || effectiveState === "expired") && <OnchainTerminal state={effectiveState} />}
      {status && effectiveState === "active" && (status.active ? <ActiveCTO status={status} proposal={proposalQuery.data} treasury={treasuryQuery.data} /> : <OnchainActivePending chainState={chainState!} />)}
      {proposalQuery.isError && <div className="status-box status-error mt-4 text-sm">Active proposal could not be loaded.</div>}
      {treasuryQuery.isError && <div className="status-box status-error mt-4 text-sm">Treasury could not be loaded.</div>}
      {transfersQuery.data && <TransferList items={transfersQuery.data.items} nextCursor={transfersQuery.data.next_cursor} />}
      {feePullsQuery.data && <FeePullList items={feePullsQuery.data.items} nextCursor={feePullsQuery.data.next_cursor} />}
      {checkpointsQuery.data && <CheckpointList page={checkpointsQuery.data} />}
      {proposalsQuery.data && <ProposalList items={proposalsQuery.data.items} nextCursor={proposalsQuery.data.next_cursor} />}
    </div>
  </section>;
}

function StatusBadge({ state, pending, failed }: { state: CurrentState; pending: boolean; failed: boolean }) {
  if (pending) return <span className="badge-neutral">Loading</span>;
  if (failed) return <span className="badge-warning">Unavailable</span>;
  const label = state === "checking" ? "Checking" : state.charAt(0).toUpperCase() + state.slice(1);
  return <span className={state === "active" ? "badge-success" : "badge-neutral"}>{label}</span>;
}

type Wallet = ReturnType<typeof useActiveWallet>;

async function invalidateCTO(client: ReturnType<typeof useQueryClient>, token: string, proposal?: CTOProposal) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["cto-status", token] }),
    client.invalidateQueries({ queryKey: ["cto-proposals", token] }),
    client.invalidateQueries({ queryKey: ["cto-onchain", token] }),
    proposal?.treasury ? client.invalidateQueries({ queryKey: ["cto-treasury", proposal.treasury] }) : Promise.resolve(),
  ]);
}

function InactiveCTO({ tokenAddress, chainCreator, wallet, onConfirmed }: { tokenAddress: string; chainCreator?: Address; wallet: Wallet; onConfirmed: () => Promise<void> }) {
  const [controller, setController] = useState("");
  const [metadataURI, setMetadataURI] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const isCreator = Boolean(wallet.activeAddress && chainCreator && wallet.activeAddress.toLowerCase() === chainCreator.toLowerCase());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!wallet.walletClient || !wallet.activeAddress) return;
    setPending(true); setMessage("");
    try {
      const hash = await proposeCTO(wallet.walletClient, wallet.activeAddress, getAddress(tokenAddress), controller, metadataURI);
      setMessage(`Proposal confirmed: ${hash}`);
      await onConfirmed();
    } catch (reason) { setMessage(actionError(reason)); }
    finally { setPending(false); }
  }
  if (!chainCreator) return <div className="status-box text-sm text-zinc-400">Verifying the canonical creator on Arc Testnet…</div>;
  if (!isCreator) return <div className="status-box text-sm text-zinc-400">No live community takeover proposal exists. Only the canonical token creator can start one.</div>;
  return <form className="grid gap-4" onSubmit={submit}>
    <div className="status-box text-sm leading-6 text-zinc-300">CTO handover is voluntary and one-way after activation. The controller must be a deployed contract, normally a Safe. Acceptance is available for 7 days, followed by a 72-hour execution delay. Creator fee routing changes only at activation; accrued creator fees are checkpointed for the previous recipient.</div>
    <label className="grid gap-1 text-sm text-zinc-300">Controller contract address<input aria-label="Controller contract address" className="terminal-input" value={controller} onChange={(event) => setController(event.target.value)} placeholder="0x…" required /></label>
    <label className="grid gap-1 text-sm text-zinc-300">Metadata URI <span className="text-xs text-zinc-600">Optional; its UTF-8 bytes are hashed automatically.</span><input aria-label="Metadata URI" className="terminal-input" value={metadataURI} onChange={(event) => setMetadataURI(event.target.value)} placeholder="ipfs://…" /></label>
    <WalletAction wallet={wallet} pending={pending} label="Start community takeover" />
    {message && <p className={`status-box text-sm ${message.startsWith("Proposal confirmed") ? "status-success" : "status-error"}`}>{message}</p>}
  </form>;
}

function ProposalWorkflow({ chainState, indexedProposal, wallet, onConfirmed }: { chainState: CTOChainState; indexedProposal?: CTOProposal; wallet: Wallet; onConfirmed: () => Promise<void> }) {
  const now = useUnixNow();
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const chainProposal = chainState.proposal!;
  const proposalId = chainState.currentProposalId;
  const currentTime = chainState.blockTimestamp;
  const acceptedAt = Number(chainProposal.acceptedAt);
  const acceptanceDeadline = Number(chainProposal.createdAt) + (chainState.acceptanceWindow || CTO_ACCEPTANCE_WINDOW);
  const executeAfter = acceptedAt + (chainState.executionDelay || CTO_EXECUTION_DELAY);
  const executeDeadline = executeAfter + (chainState.executionGracePeriod || CTO_EXECUTION_GRACE_PERIOD);
  const isCreator = Boolean(wallet.activeAddress && wallet.activeAddress.toLowerCase() === chainState.creator.toLowerCase());
  const isController = Boolean(wallet.activeAddress && wallet.activeAddress.toLowerCase() === chainProposal.controller.toLowerCase());
  const proposed = chainProposal.state === 1;
  const accepted = chainProposal.state === 2;
  const canExpire = (proposed && currentTime > acceptanceDeadline) || (accepted && currentTime > executeDeadline);
  const canExecute = accepted && currentTime >= executeAfter && currentTime <= executeDeadline;
  const payload = buildCTOAcceptancePayload(chainProposal.treasury, proposalId);
  async function run(action: "accept" | "cancel" | "expire" | "execute") {
    if (!wallet.walletClient || !wallet.activeAddress) return;
    setPending(true); setMessage("");
    try {
      const token = getAddress(chainProposal.token);
      const hash = action === "accept" ? await acceptCTOFromController(wallet.walletClient, wallet.activeAddress, token, proposalId)
        : action === "cancel" ? await cancelCTO(wallet.walletClient, wallet.activeAddress, token, proposalId)
          : action === "expire" ? await expireCTO(wallet.walletClient, wallet.activeAddress, token, proposalId)
            : await executeCTO(wallet.walletClient, wallet.activeAddress, token, proposalId);
      setMessage(`Transaction confirmed: ${hash}`); await onConfirmed();
    } catch (reason) { setMessage(actionError(reason)); }
    finally { setPending(false); }
  }
  return <div className="grid gap-4">
    <CurrentProposalCard proposalId={proposalId} chainState={chainState} indexedProposal={indexedProposal} />
    {proposed && <div className="status-box text-sm leading-6 text-zinc-300"><p className="font-semibold text-white">Controller acceptance required</p><p className="mt-1">Acceptance must be executed by the controller contract through the deployed CTO treasury before {formatAbsoluteUTC(acceptanceDeadline)}.</p></div>}
    {proposed && <dl className="grid gap-2 text-sm"><CTODetail label="Controller" value={chainProposal.controller} href={explorerAddressURL(chainProposal.controller)} /><CTODetail label="CTO treasury" value={chainProposal.treasury} href={explorerAddressURL(chainProposal.treasury)} /><CTODetail label="Proposal ID" value={proposalId} /><CTODetail label="Target" value={payload.target} /><CTODetail label="Function" value="acceptCTO(bytes32)" /><CTODetail label="Value" value="0" /><CTODetail label="Calldata" value={payload.data} /></dl>}
    {proposed && <button type="button" className="button-secondary min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify({ target: payload.target, value: "0", data: payload.data })); setCopied(true); } catch { setMessage("The acceptance payload could not be copied. Select the fields above manually."); } }}>{copied ? "Acceptance payload copied" : "Copy acceptance payload"}</button>}
    {proposed && !isController && <p className="text-sm text-zinc-400">Submit this payload through the controller contract wallet or Safe. An ordinary EOA cannot impersonate the controller.</p>}
    {proposed && isController && <button className="button-primary min-h-11" disabled={pending || !wallet.canTransact || !chainState} onClick={() => run("accept")}>Accept through controller</button>}
    {accepted && !canExecute && !canExpire && <div className="status-box text-sm text-zinc-300"><p className="font-semibold text-white">Accepted — protocol timelock</p><p className="mt-1">Accepted {formatAbsoluteUTC(acceptedAt)}. Execution becomes available after the protocol timelock at {formatAbsoluteUTC(executeAfter)} ({now === null ? "loading" : formatRelativeAge(now, executeAfter)} remaining). The execution deadline is {formatAbsoluteUTC(executeDeadline)}.</p></div>}
    {accepted && canExecute && <button className="button-primary min-h-11" disabled={pending || !wallet.canTransact || !chainState} onClick={() => run("execute")}>Execute community takeover</button>}
    {(proposed || accepted) && isCreator && <button className="button-secondary min-h-11" disabled={pending || !wallet.canTransact || !chainState} onClick={() => run("cancel")}>Cancel proposal</button>}
    {canExpire && <button className="button-secondary min-h-11" disabled={pending || !wallet.canTransact || !chainState} onClick={() => run("expire")}>Mark expired</button>}
    {!wallet.canTransact && <p className="text-xs text-zinc-500">{activeWalletStatusMessage(wallet.status)}</p>}
    {message && <p className={`status-box text-sm ${message.startsWith("Transaction confirmed") ? "status-success" : "status-error"}`}>{message}</p>}
  </div>;
}

function CurrentProposalCard({ proposalId, chainState, indexedProposal }: { proposalId: Hex; chainState: CTOChainState; indexedProposal?: CTOProposal }) {
  const proposal = chainState.proposal!;
  return <div className="rounded-xl border border-white/8 bg-black/20 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-white">Proposal</p><span className="badge-neutral">{currentState(chainState)}</span></div>
    {!indexedProposal && <p className="mt-2 text-xs text-zinc-500">Proposal confirmed on Arc Testnet — indexed history is catching up.</p>}
    <dl className="mt-3 grid gap-2 text-sm">
      <CTODetail label="Proposal ID" value={proposalId} />
      <CTODetail label="Nonce" value={proposal.nonce.toString()} />
      <CTODetail label="Metadata hash" value={proposal.metadataHash} />
      <div className="min-w-0"><dt className="text-zinc-600">Metadata URI</dt>{indexedProposal ? <MetadataURI value={indexedProposal.metadata_uri} /> : <dd className="mt-1 text-zinc-500">Indexing in progress</dd>}</div>
    </dl>
  </div>;
}

function OnchainTerminal({ state }: { state: "cancelled" | "expired" }) {
  return <div className="status-box text-sm text-zinc-300"><span className="font-semibold capitalize text-white">{state}</span> — this proposal is terminal on Arc Testnet. Indexed history is catching up; no proposal actions are available.</div>;
}

function OnchainActivePending({ chainState }: { chainState: CTOChainState }) {
  const proposal = chainState.proposal!;
  return <div className="grid gap-4">
    <div className="status-box status-success text-sm leading-6"><p className="font-semibold text-white">Community takeover active on Arc Testnet</p><p className="mt-1">Activation is confirmed on-chain. Indexed activation history and fee-routing details are catching up.</p></div>
    <dl className="grid gap-2 text-sm"><CTODetail label="CTO treasury" value={proposal.treasury} href={explorerAddressURL(proposal.treasury)} /><CTODetail label="Controller" value={proposal.controller} href={explorerAddressURL(proposal.controller)} /><CTODetail label="Previous recipient" value={proposal.previousRecipient} href={explorerAddressURL(proposal.previousRecipient)} /><CTODetail label="Active proposal" value={chainState.currentProposalId} /></dl>
  </div>;
}

function WalletAction({ wallet, pending, label }: { wallet: Wallet; pending: boolean; label: string }) {
  if (!wallet.connected) return <button type="button" className="button-primary min-h-11" onClick={() => wallet.connectWallet()}>Connect wallet</button>;
  if (wallet.status === "wrong_network") return <button type="button" className="button-primary min-h-11" onClick={() => wallet.switchToSelectedChain()}>Switch to Arc Testnet</button>;
  return <button type="submit" className="button-primary min-h-11" disabled={pending || !wallet.canTransact}>{pending ? "Confirming transaction…" : label}</button>;
}

function actionError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "The CTO transaction failed.";
  return /reject|denied|cancelled/i.test(message) ? "The wallet request was rejected." : message;
}

function ActiveCTO({ status, proposal, treasury }: { status: CTOStatus; proposal?: CTOProposal; treasury?: CTOTreasury }) {
  return <div className="grid gap-4">
    <div className="status-box status-success text-sm leading-6"><p className="font-semibold text-white">Community takeover active</p><p className="mt-1">The handover is terminal under the current CTO policy. Creator fee routing is active for the canonical CTO treasury.</p></div>
    <dl className="grid gap-3 text-sm">
      {status.registry && <CTODetail label="Registry" value={status.registry} href={explorerAddressURL(status.registry)} />}
      {status.treasury && <CTODetail label="Treasury" value={status.treasury} href={explorerAddressURL(status.treasury)} />}
      {status.controller && <CTODetail label="Controller" value={status.controller} href={explorerAddressURL(status.controller)} />}
      {status.previous_recipient && <CTODetail label="Previous recipient" value={status.previous_recipient} href={explorerAddressURL(status.previous_recipient)} />}
      <CTODetail label="Fee routing" value="CTO treasury active" />
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
