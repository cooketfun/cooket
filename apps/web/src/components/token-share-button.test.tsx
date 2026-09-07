import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenShareButton } from "./token-share-button";

const url = "https://cooket.fun/token/0x1234567890123456789012345678901234567890";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
});

describe("TokenShareButton", () => {
  it("uses the native share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    render(<TokenShareButton url={url} title="Cookie Coin" description="A token" />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "Cookie Coin", text: "A token", url }));
    expect(screen.getByRole("button").textContent).toBe("Share");
  });

  it("copies the canonical URL and confirms success when native sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<TokenShareButton url={url} title="Cookie Coin" description="A token" />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
    expect(screen.getByRole("button").textContent).toBe("Link copied");
  });
});
