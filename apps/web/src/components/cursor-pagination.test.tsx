import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CursorPagination, paginationItems } from "./cursor-pagination";

describe("CursorPagination", () => {
  it("uses deterministic known pages without inventing a last page", () => {
    expect(paginationItems(1, 3)).toEqual([1, 2, 3]);
    expect(paginationItems(5, 10)).toEqual([1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
  });

  it("exposes accessible previous, next, and page controls", () => {
    const change = vi.fn();
    render(<CursorPagination currentPage={2} pageCount={3} onPageChange={change} label="Launch pages" />);
    expect(screen.getByRole("navigation", { name: "Launch pages" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 2" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(change.mock.calls).toEqual([[1], [3]]);
  });

  it("marks an open-ended cursor sequence without claiming a final page", () => {
    render(<CursorPagination currentPage={1} pageCount={2} hasUnknownPages onPageChange={() => undefined} />);
    expect(screen.getByLabelText("More pages may be available")).toBeTruthy();
  });
});
