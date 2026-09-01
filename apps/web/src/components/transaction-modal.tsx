"use client";

import { useEffect, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { explorerTransactionURL, selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";
import { transactionPhaseIsBusy, transactionPhaseLabel, type TransactionModalPhase } from "@/lib/transaction-modal";

export type TransactionDetail = { label: string; value: ReactNode };

export function TransactionModal({ open, title, phase, wallet, details, hash, error, onConfirm, onClose, confirmLabel = "Confirm transaction", confirmDisabled = false, statusLabel, children }: {
  open: boolean; title: string; phase: TransactionModalPhase; wallet?: Address; details: TransactionDetail[]; hash?: Hash;
  error?: string; onConfirm?: () => void; onClose: () => void; confirmLabel?: string; confirmDisabled?: boolean; statusLabel?: string; children?: ReactNode;
}) {
  const busy = transactionPhaseIsBusy(phase);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose, open]);
  if (!open) return null;
  const problem = ["failed", "rejected", "expired"].includes(phase);
  return <div className="transaction-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-modal-title" aria-live="polite">
      <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Wallet transaction</p><h2 id="transaction-modal-title" className="mt-1 text-xl font-semibold text-white">{title}</h2></div>
        {!busy && <button type="button" className="transaction-modal-close" aria-label="Close transaction modal" onClick={onClose}>×</button>}
      </div>
      <div className={`transaction-modal-state ${problem ? "transaction-modal-state-error" : phase === "confirmed" ? "transaction-modal-state-success" : ""}`}>
        <span className={`h-2.5 w-2.5 flex-none rounded-full ${busy ? "animate-pulse bg-cyan-300" : phase === "confirmed" ? "bg-emerald-300" : problem ? "bg-rose-300" : "bg-amber-300"}`} />
        <div><p className="font-semibold text-zinc-100">{statusLabel ?? transactionPhaseLabel(phase)}</p>{phase === "rejected" && <p className="mt-1 text-xs text-zinc-400">Nothing was submitted by Cooket.</p>}</div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <ModalRow label="Wallet" value={wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Not connected"} />
        <ModalRow label="Network" value={`${selectedCooketChainName} · ${selectedCooketChainId}`} />
        {details.map((detail) => <ModalRow key={detail.label} label={detail.label} value={detail.value} />)}
      </dl>
      {hash && <a aria-label="View Explorer" className="mt-4 block break-all rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-3 text-sm text-cyan-200 hover:bg-cyan-300/[0.08]" href={explorerTransactionURL(hash)} target="_blank" rel="noreferrer">View {hash.slice(0, 10)}…{hash.slice(-8)} on ArcScan ↗</a>}
      {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-sm leading-6 text-rose-200">{error}</p>}
      {children}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {!busy && phase !== "confirmed" && <button className="button-secondary" type="button" onClick={onClose}>{problem ? "Close" : "Cancel"}</button>}
        {phase === "review" && onConfirm && <button className="button-primary" type="button" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>}
        {phase === "confirmed" && <button className="button-primary" type="button" onClick={onClose}>Done</button>}
      </div>
    </section>
  </div>;
}

function ModalRow({ label, value }: TransactionDetail) {
  return <div className="flex min-w-0 items-start justify-between gap-4"><dt className="text-zinc-500">{label}</dt><dd className="min-w-0 break-words text-right font-medium text-zinc-100">{value}</dd></div>;
}
