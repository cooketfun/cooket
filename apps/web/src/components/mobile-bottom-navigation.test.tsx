import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const usePathname = vi.fn(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

import { isMobileNavActive, MobileBottomNavigation } from "./mobile-bottom-navigation";

const navigationSource = readFileSync(resolve(process.cwd(), "src/components/navigation.tsx"), "utf8");

afterEach(cleanup);

beforeEach(() => {
  usePathname.mockReturnValue("/");
});

describe("mobile navigation", () => {
  it("renders the smartphone app-shell routes and search control", () => {
    const onSearch = vi.fn();
    render(<MobileBottomNavigation onSearch={onSearch} />);
    expect(screen.getByRole("navigation", { name: "Mobile app navigation" }).className).toContain("md:hidden");
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Create" }).getAttribute("href")).toBe("/create");
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("href")).toBe("/profile");
    expect(screen.getByRole("button", { name: "Search tokens" })).toBeTruthy();
  });

  it("marks the active route", () => {
    usePathname.mockReturnValue("/profile");
    render(<MobileBottomNavigation onSearch={() => undefined} />);
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Create" }).getAttribute("aria-current")).toBeNull();
  });

  it("toggles the existing search overlay from the search control", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<MobileBottomNavigation searchOpen onSearch={onSearch} />);
    expect(screen.getByRole("button", { name: "Search tokens" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Search tokens" }));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps desktop search and hides the permanent mobile search field", () => {
    expect(navigationSource).toContain('id="desktop-token-search"');
    expect(navigationSource).toContain("MobileBottomNavigation");
    expect(navigationSource).toContain("MobileSearchOverlay");
    expect(navigationSource).not.toContain('className="pb-2.5 md:hidden"');
    expect(isMobileNavActive("/", "/")).toBe(true);
    expect(isMobileNavActive("/create", "/")).toBe(false);
    expect(isMobileNavActive("/profile/export", "/profile")).toBe(true);
  });
});
