import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const activity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, activity } };
});

import { TokenActivity } from "./token-activity";

const event = (block: number) => ({ event_name: `Event ${block}`, decoded: {}, block_number: block, transaction_index: 0, transaction_hash: `0x${String(block).padStart(64, "0")}`, log_index: 0 });
function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TokenActivity pagination", () => {
  it("loads bounded cursor pages and navigates next then previous", async () => {
    activity.mockImplementation((_address: string, query: string) => query.includes("cursor=next")
      ? Promise.resolve({ items: [event(2)] })
      : Promise.resolve({ items: [event(1)], next_cursor: "next" }));
    const user = userEvent.setup();
    render(<TokenActivity tokenAddress="0x0000000000000000000000000000000000000001" />, { wrapper: Providers });
    expect(await screen.findByText("Event 1")).toBeTruthy();
    expect(activity).toHaveBeenCalledWith(expect.any(String), "?limit=10");
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Event 2")).toBeTruthy();
    expect(activity).toHaveBeenCalledWith(expect.any(String), "?limit=10&cursor=next");
    expect(screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(screen.getByText("Event 1")).toBeTruthy());
  });

  it("never renders more than the bounded API page", async () => {
    activity.mockResolvedValue({ items: Array.from({ length: 10 }, (_, index) => event(index + 1)) });
    render(<TokenActivity tokenAddress="0x0000000000000000000000000000000000000001" />, { wrapper: Providers });
    expect(await screen.findAllByRole("listitem")).toHaveLength(10);
    expect(screen.queryByRole("navigation", { name: "Token activity pages" })).toBeNull();
  });
});
