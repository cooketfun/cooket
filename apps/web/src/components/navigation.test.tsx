import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/profile/settings" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: () => <span data-testid="mock-image" /> }));
vi.mock("./header-token-search", () => ({ HeaderTokenSearch: () => <div /> }));
vi.mock("./mobile-search-overlay", () => ({ MobileSearchOverlay: () => null }));
vi.mock("./mobile-bottom-navigation", () => ({ MobileBottomNavigation: () => <div /> }));
vi.mock("./wallet-status", () => ({ WalletStatus: () => <div>Wallet</div> }));

import { Navigation } from "./navigation";

afterEach(cleanup);

describe("application documentation navigation", () => {
  it("renders Docs as an external link on desktop and mobile", () => {
    render(<Navigation />);
    const docsLinks = screen.getAllByRole("link", { name: /Docs/ });
    expect(docsLinks).toHaveLength(2);
    for (const link of docsLinks) {
      expect(link.getAttribute("href")).toBe("https://docs.cooket.fun");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("aria-current")).toBeNull();
    }
  });

  it("preserves internal matching and exposes Docs in the tablet menu", () => {
    render(<Navigation />);
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const tablet = screen.getByRole("navigation", { name: "Tablet navigation" });
    const docs = tablet.querySelector('a[href="https://docs.cooket.fun"]');
    expect(docs?.textContent).toContain("Docs");
    expect(docs?.getAttribute("target")).toBe("_blank");
  });
});
