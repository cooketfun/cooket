"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export function HorizontalCarousel({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ previous: false, next: false });
  const updateBounds = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const maximum = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const next = { previous: rail.scrollLeft > 1, next: rail.scrollLeft < maximum - 1 };
    setBounds((current) => current.previous === next.previous && current.next === next.next ? current : next);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    updateBounds();
    rail.addEventListener("scroll", updateBounds, { passive: true });
    window.addEventListener("resize", updateBounds);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateBounds);
    observer?.observe(rail);
    return () => {
      rail.removeEventListener("scroll", updateBounds);
      window.removeEventListener("resize", updateBounds);
      observer?.disconnect();
    };
  }, [children, updateBounds]);

  const move = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(240, rail.clientWidth * 0.85), behavior: "smooth" });
  };

  return <div className={className}>
    <div className="mb-2 flex justify-end gap-2" aria-label={`${label} controls`}>
      <button type="button" className="carousel-button" aria-label={`Previous ${label}`} disabled={!bounds.previous} onClick={() => move(-1)}>←</button>
      <button type="button" className="carousel-button" aria-label={`Next ${label}`} disabled={!bounds.next} onClick={() => move(1)}>→</button>
    </div>
    <div ref={railRef} className="market-rail scrollbar-hidden" role="region" aria-label={label} tabIndex={0} onKeyDown={(event) => {
      if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    }}>{children}</div>
  </div>;
}
