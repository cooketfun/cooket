"use client";

import { useEffect, useRef } from "react";
import { HeaderTokenSearch } from "./header-token-search";

export function MobileSearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return <div className="fixed inset-0 z-[60] bg-[#05070d]/96 px-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl md:hidden" role="dialog" aria-modal="true" aria-label="Search tokens">
    <div className="mx-auto flex w-full max-w-lg items-center gap-2">
      <div className="min-w-0 flex-1"><HeaderTokenSearch id="mobile-token-search" autoFocus onNavigate={onClose} /></div>
      <button ref={closeRef} type="button" className="button-secondary min-h-11 px-3 text-sm" onClick={onClose}>Close</button>
    </div>
  </div>;
}
