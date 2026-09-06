"use client";

import { useCallback, useMemo, useState } from "react";

type CursorState = { cursors: string[]; index: number; terminalIndex?: number };

export function useCursorPagination() {
  const [state, setState] = useState<CursorState>({ cursors: [""], index: 0 });

  const discoverNext = useCallback((nextCursor?: string | null) => {
    setState((value) => {
      if (!nextCursor) return { cursors: value.cursors.slice(0, value.index + 1), index: value.index, terminalIndex: value.index };
      if (value.cursors[value.index + 1] === nextCursor) return value;
      return { cursors: [...value.cursors.slice(0, value.index + 1), nextCursor], index: value.index };
    });
  }, []);

  const goToPage = useCallback((page: number) => {
    setState((value) => {
      const index = page - 1;
      if (index < 0 || index >= value.cursors.length) return value;
      return { ...value, index };
    });
  }, []);

  return {
    cursor: state.cursors[state.index] ?? "",
    currentPage: state.index + 1,
    pageCount: state.cursors.length,
    hasUnknownPages: state.terminalIndex === undefined,
    discoverNext,
    goToPage,
  };
}

export function CursorPagination({ currentPage, pageCount, hasUnknownPages = false, onPageChange, label = "Pagination", disabled = false }: {
  currentPage: number;
  pageCount: number;
  hasUnknownPages?: boolean;
  onPageChange: (page: number) => void;
  label?: string;
  disabled?: boolean;
}) {
  const pages = useMemo(() => paginationItems(currentPage, pageCount), [currentPage, pageCount]);
  if (pageCount <= 1) return null;

  return <nav className="mt-5 flex items-center justify-center gap-1" aria-label={label}>
    <button type="button" className="pagination-button" aria-label="Previous page" disabled={disabled || currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>←</button>
    {pages.map((item, index) => item === "ellipsis"
      ? <span key={`ellipsis-${index}`} className="flex h-10 min-w-7 items-center justify-center text-zinc-600" aria-hidden="true">…</span>
      : <button key={item} type="button" className={`pagination-button ${item === currentPage ? "pagination-button-active" : ""}`} aria-label={`Page ${item}`} aria-current={item === currentPage ? "page" : undefined} disabled={disabled} onClick={() => onPageChange(item)}>{item}</button>)}
    {hasUnknownPages && <span className="flex h-10 min-w-7 items-center justify-center text-zinc-600" title="More pages may be available" aria-label="More pages may be available">…</span>}
    <button type="button" className="pagination-button" aria-label="Next page" disabled={disabled || currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)}>→</button>
  </nav>;
}

export function paginationItems(current: number, count: number): Array<number | "ellipsis"> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const visible = new Set([1, count, current - 1, current, current + 1].filter((page) => page >= 1 && page <= count));
  const sorted = [...visible].sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}
