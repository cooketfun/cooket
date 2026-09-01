"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MobileBottomNavigation({ searchOpen = false, onSearch }: { searchOpen?: boolean; onSearch: () => void }) {
  const pathname = usePathname();

  return <nav className="mobile-bottom-nav md:hidden" aria-label="Mobile app navigation">
    <div className="mx-auto grid max-w-lg grid-cols-4 items-end px-2 pt-1">
      <NavItem href="/" label="Explore" icon="⌂" active={pathname === "/"} />
      <button type="button" aria-label="Search tokens" aria-pressed={searchOpen} onClick={onSearch} className={navClass(searchOpen)}>
        <span aria-hidden className="text-lg leading-none">⌕</span>
        <span>Search</span>
      </button>
      <NavItem href="/create" label="Create" icon="+" active={isActive(pathname, "/create")} primary />
      <NavItem href="/profile" label="Profile" icon="◉" active={isActive(pathname, "/profile")} />
    </div>
  </nav>;
}

function NavItem({ href, label, icon, active, primary = false }: { href: string; label: string; icon: string; active: boolean; primary?: boolean }) {
  return <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={primary ? primaryClass(active) : navClass(active)}>
    <span aria-hidden className={primary ? "text-2xl leading-none" : "text-lg leading-none"}>{icon}</span>
    <span>{label}</span>
  </Link>;
}

function navClass(active: boolean) {
  return `flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[0.62rem] font-semibold ${active ? "text-cyan-200" : "text-zinc-500 hover:text-zinc-200"}`;
}

function primaryClass(active: boolean) {
  return `flex min-h-11 flex-col items-center justify-center gap-0.5 text-[0.62rem] font-semibold ${active ? "text-cyan-100" : "text-cyan-300"}`;
}

export function isMobileNavActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function isActive(pathname: string, href: string) {
  return isMobileNavActive(pathname, href);
}
