"use client";

import { useEffect, useState } from "react";

const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: (now: number) => void) {
  listeners.add(listener);
  listener(Math.floor(Date.now() / 1000));
  if (!timer) timer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const current of listeners) current(now);
  }, 30_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useUnixNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => subscribe(setNow), []);
  return now;
}

export function formatRelativeAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor(now - timestamp));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 604_800)}w`;
  return `${Math.floor(seconds / 2_592_000)}mo`;
}

export function formatAbsoluteUTC(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(timestamp * 1000));
}
