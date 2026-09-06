import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HorizontalCarousel } from "./horizontal-carousel";

describe("HorizontalCarousel", () => {
  it("hides the native scrollbar and navigates within real boundaries", async () => {
    render(<HorizontalCarousel label="Top indexed tokens"><div>One</div><div>Two</div></HorizontalCarousel>);
    const rail = screen.getByRole("region", { name: "Top indexed tokens" });
    Object.defineProperties(rail, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 900 },
    });
    Object.defineProperty(rail, "scrollBy", { configurable: true, value: vi.fn(({ left }: ScrollToOptions) => {
      rail.scrollLeft += left ?? 0;
      fireEvent.scroll(rail);
    }) });
    fireEvent(window, new Event("resize"));

    const previous = screen.getByRole("button", { name: "Previous Top indexed tokens" });
    const next = screen.getByRole("button", { name: "Next Top indexed tokens" });
    expect(rail.className).toContain("scrollbar-hidden");
    expect(previous.hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));
    fireEvent.click(next);
    await waitFor(() => expect(previous.hasAttribute("disabled")).toBe(false));
    expect(rail.scrollBy).toHaveBeenCalled();

    rail.scrollLeft = 600;
    fireEvent.scroll(rail);
    await waitFor(() => expect(next.hasAttribute("disabled")).toBe(true));
  });
});
