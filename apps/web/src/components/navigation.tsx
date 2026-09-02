"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { HeaderTokenSearch } from "./header-token-search";
import { MobileBottomNavigation } from "./mobile-bottom-navigation";
import { MobileSearchOverlay } from "./mobile-search-overlay";
import { WalletStatus } from "./wallet-status";

const links = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/profile", label: "Profile" },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return <>
    <header className="site-header sticky top-0 z-50 border-b border-white/8 bg-[#05070d]/94 backdrop-blur-xl">
      <div className="market-container">
        <div className="grid min-h-12 grid-cols-[auto_1fr_auto] items-center gap-3 md:min-h-16">
          <Link href="/" className="flex min-h-11 items-center gap-2 rounded-lg text-lg font-semibold tracking-[-0.04em] text-white md:text-xl" onClick={() => { setOpen(false); setSearchOpen(false); }} aria-label="Cooket home">
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-cyan-300/20 bg-[#0d1322]" data-logo-source="/brand/cooket.png"><Image src="/brand/cooket.png" alt="Cooket logo" width={32} height={32} priority className="h-8 w-8 object-contain" /></span>
            <span>Cooket</span>
          </Link>
          <div className="mx-auto hidden w-full max-w-xl px-2 md:block"><HeaderTokenSearch id="desktop-token-search" /></div>
          <div className="hidden items-center justify-end gap-2 xl:flex">
            <nav className="flex items-center gap-0.5 text-sm" aria-label="Primary navigation">
              {links.map((link) => <NavLink key={link.href} {...link} active={isActive(pathname, link.href)} />)}
            </nav>
            <div className="hidden min-w-0 xl:flex"><WalletStatus key={`desktop:${pathname}`} /></div>
          </div>
          <div className="flex items-center justify-end gap-2 md:hidden">
            <WalletStatus key={`mobile:${pathname}`} compact short />
          </div>
          <div className="hidden md:block xl:hidden"><button className="button-secondary h-11 w-11 p-0" type="button" aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((current) => !current)}>
            <span aria-hidden className="text-xl leading-none">{open ? "×" : "≡"}</span>
          </button></div>
        </div>
        {open && <div id="mobile-navigation" className="hidden border-t border-white/8 py-3 md:block xl:hidden">
          <nav className="grid grid-cols-3 gap-2" aria-label="Tablet navigation">
            {links.map((link) => <NavLink key={link.href} {...link} active={isActive(pathname, link.href)} onClick={() => setOpen(false)} />)}
          </nav>
          <div className="mt-3 border-t border-white/8 pt-3"><WalletStatus key={`tablet:${pathname}`} compact /></div>
        </div>}
      </div>
    </header>
    <MobileSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    <MobileBottomNavigation searchOpen={searchOpen} onSearch={() => setSearchOpen((current) => !current)} />
  </>;
}

function NavLink({ href, label, active, onClick }: { href: string; label: string; active: boolean; onClick?: () => void }) {
  return <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined} className={`flex min-h-10 items-center justify-center rounded-lg px-3 font-medium transition-colors ${active ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}>{label}</Link>;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
