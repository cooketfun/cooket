"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type SheetContext = {
  open: boolean;
  openSheet: () => void;
  closeSheet: () => void;
};

const TokenTradeSheetContext = createContext<SheetContext | null>(null);

export function TokenTradeSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSheet = useCallback(() => setOpen(true), []);
  const closeSheet = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, openSheet, closeSheet }), [closeSheet, open, openSheet]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSheet, open]);

  return <TokenTradeSheetContext.Provider value={value}>{children}</TokenTradeSheetContext.Provider>;
}

export function useTokenTradeSheet() {
  const context = useContext(TokenTradeSheetContext);
  if (!context) throw new Error("TokenTradeSheetProvider is required.");
  return context;
}

export function TradeSheetSurface({ children }: { children: ReactNode }) {
  const { open, closeSheet } = useTokenTradeSheet();
  return <div className="trade-sheet-root" data-open={open ? "true" : "false"}>
    {open && <button type="button" className="terminal-trade-sheet-backdrop md:hidden" aria-label="Dismiss trade panel" onClick={closeSheet} />}
    <div className="trade-sheet-panel">
      <div className="mb-3 flex items-center justify-between gap-3 md:hidden">
        <p className="text-sm font-semibold text-white">Trade</p>
        <button type="button" className="button-ghost min-h-11 px-3 text-sm" onClick={closeSheet}>Close</button>
      </div>
      {children}
    </div>
  </div>;
}

export function MobileTradeActions({ symbol }: { symbol: string }) {
  const { open, openSheet } = useTokenTradeSheet();
  if (open) return null;
  return <div className="mobile-trade-actions md:hidden" aria-label="Trade actions">
    <button type="button" className="min-h-11 flex-1 rounded-xl bg-emerald-400 text-sm font-semibold text-[#03251a]" onClick={openSheet}>Buy {symbol}</button>
    <button type="button" className="min-h-11 flex-1 rounded-xl bg-red-500 text-sm font-semibold text-white" onClick={openSheet}>Sell {symbol}</button>
  </div>;
}
