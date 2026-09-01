"use client";

import { useEffect, useRef, useState } from "react";
import { explorerAddressURL, selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";
import { useActiveWallet } from "@/providers/active-wallet-provider";

export function WalletStatus({ compact = false }: { compact?: boolean; short?: boolean }) {
  const wallet = useActiveWallet();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onNavigation = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onNavigation);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onNavigation);
    };
  }, []);

  if (wallet.status === "sdk_not_ready") return <WalletLoading compact label="Restoring wallet…" />;
  if (wallet.status === "initialization_error") return <div className="wallet-config-alert" role="alert" title={wallet.error}>Wallet unavailable</div>;
  if (wallet.status === "disconnected") return <div className="wallet-control-root"><button className={`button-primary wallet-connect-button ${compact ? "wallet-control-compact" : ""}`} type="button" onClick={() => void wallet.connectWallet()}>Connect wallet</button>{wallet.error && <WalletActionError message={wallet.error} />}</div>;
  if (wallet.status === "disconnecting") return <WalletLoading compact label="Disconnecting…" />;

  const label = wallet.activeAddress ? truncateAddress(wallet.activeAddress) : "Wallet loading…";
  return <div className={`wallet-control-root ${compact ? "w-full" : ""}`} ref={root} aria-label="External wallet controls">
    <button
      className={`wallet-account-button ${compact ? "wallet-control-compact" : ""}`}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    >
      <Identicon address={wallet.activeAddress} />
      <span className="min-w-0 truncate font-mono text-xs">{label}</span>
      {!compact && <span className={wallet.status === "wrong_network" ? "wallet-chain-wrong" : "wallet-chain-ready"}>{wallet.status === "wrong_network" ? "Wrong network" : "Arc"}</span>}
      <span aria-hidden className="text-[0.65rem] text-zinc-500">▾</span>
    </button>
    {open && <AccountMenu wallet={wallet} close={() => setOpen(false)} />}
    {wallet.error && !open && <WalletActionError message={wallet.error} />}
  </div>;
}

function AccountMenu({ wallet, close }: { wallet: ReturnType<typeof useActiveWallet>; close: () => void }) {
  const perform = async (action: () => Promise<void>) => {
    try { await action(); close(); } catch { /* Provider exposes the actionable error. */ }
  };
  const copyAddress = async () => {
    if (!wallet.activeAddress) return;
    await navigator.clipboard.writeText(wallet.activeAddress);
    close();
  };
  return <section className="wallet-account-menu" role="menu" aria-label="Account menu">
    <div className="border-b border-white/8 p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-cyan-300">Active signer</p>
      <p className="mt-1 truncate font-mono text-xs text-zinc-200" title={wallet.activeAddress}>{wallet.activeAddress ? truncateAddress(wallet.activeAddress) : "Select a wallet"}</p>
      <p className={`mt-1 text-xs ${wallet.status === "wrong_network" ? "text-amber-300" : "text-zinc-500"}`}>{wallet.status === "wrong_network" ? `Switch to ${selectedCooketChainName} · ${selectedCooketChainId}` : wallet.status === "wallet_ready" ? `${selectedCooketChainName} · ${selectedCooketChainId}` : statusCopy(wallet.status)}</p>
    </div>
    {wallet.status === "wrong_network" && <button className="wallet-menu-action text-cyan-200" role="menuitem" type="button" onClick={() => void perform(wallet.switchToSelectedChain)}>Switch to Arc Testnet</button>}
    {wallet.activeAddress && <button className="wallet-menu-action" role="menuitem" type="button" onClick={() => void copyAddress()}>Copy address</button>}
    {wallet.activeAddress && <a className="wallet-menu-action" role="menuitem" href={explorerAddressURL(wallet.activeAddress)} target="_blank" rel="noreferrer" onClick={close}>View on ArcScan ↗</a>}
    <button className="wallet-menu-action" role="menuitem" type="button" onClick={() => { void wallet.connectWallet(); close(); }}>Change wallet</button>
    <button className="wallet-menu-action border-t border-white/8 text-rose-200" role="menuitem" type="button" onClick={() => void perform(wallet.disconnectWallet)}>Disconnect</button>
    {wallet.error && <p className="m-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-2 text-xs leading-5 text-rose-200" role="alert">{wallet.error}</p>}
  </section>;
}

function WalletLoading({ compact, label }: { compact: boolean; label: string }) { return <div className={`wallet-loading ${compact ? "wallet-control-compact" : ""}`} role="status"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" /><span className="truncate">{label}</span></div>; }
function WalletActionError({ message }: { message: string }) { return <p className="wallet-action-error" role="alert">{message}</p>; }

function Identicon({ address }: { address?: string }) {
  const seed = address?.toLowerCase().replace("0x", "") || "0000000000";
  const cells = Array.from({ length: 5 }, (_, index) => Number.parseInt(seed[index] || "0", 16) % 2 === 0);
  return <span className="wallet-identicon" aria-hidden>{cells.map((filled, index) => <span key={index} className={filled ? "bg-cyan-300" : "bg-cyan-950"} />)}</span>;
}

function truncateAddress(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function statusCopy(status: ReturnType<typeof useActiveWallet>["status"]) {
  return ({ wallet_loading: "Preparing active wallet…", signer_mismatch: "Signer verification failed", sdk_not_ready: "Restoring wallet…", disconnected: "Disconnected", wallet_ready: "Ready", wrong_network: "Wrong network", initialization_error: "Wallet unavailable", disconnecting: "Disconnecting…" } as const)[status];
}
