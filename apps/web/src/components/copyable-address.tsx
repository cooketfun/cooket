"use client";

import { useEffect, useRef, useState } from "react";

export function CopyableAddress({ address, className = "" }: { address: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  const short = address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      if (!mounted.current) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch { /* Clipboard access can be unavailable in restricted browsers. */ }
  };
  return <button type="button" className={`address inline-flex min-h-10 items-center gap-2 text-left ${className}`} title={address} aria-label={copied ? "Token address copied" : "Copy token address"} onClick={() => void copy()}>
    <span>{short}</span>
    <span className="text-[0.65rem] font-semibold text-cyan-300">{copied ? "Copied" : "Copy"}</span>
  </button>;
}
