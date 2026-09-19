"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/check", label: "Move Money" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/check" ? pathname === "/check" || pathname.startsWith("/check/") : pathname === href;
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (wasOpenRef.current && !open) menuButtonRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-[#1A1A1A]/20 bg-[#CBD2C4]/95 backdrop-blur-sm">
      <a href="#main-content" className="sr-only absolute left-3 top-3 z-50 rounded-[8px] bg-[#F5F2EA] px-3 py-2 text-sm font-semibold text-[#1A1A1A] focus:not-sr-only focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[#1A1A1A]">Skip to main content</a>
      <div className={cn("mx-auto flex min-h-20 w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8", pathname === "/" ? "max-w-[1440px]" : "max-w-[1200px]")}>
        <Link href="/" className="shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A]" onClick={() => setOpen(false)}><span className="font-brand text-[1.35rem] font-bold uppercase leading-none tracking-[0.06em] text-[#1A1A1A]">Providus</span></Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">{NAV.map((item) => <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} className={cn("rounded-[8px] px-3 py-2 text-sm font-medium tracking-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A]", isActive(pathname, item.href) ? "bg-[#1A1A1A] text-[#F5F2EA]" : "text-[#1A1A1A]/75 hover:bg-[#F5F2EA]/70 hover:text-[#1A1A1A]")}>{item.label}</Link>)}</nav>
        <div className="hidden items-center gap-3 md:flex"><ConnectWalletButton /><Link href="/check" className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#F5F2EA] px-5 text-sm font-semibold text-[#1A1A1A] transition-colors hover:bg-[#1A1A1A] hover:text-[#F5F2EA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A]">Move Money</Link></div>
        <button ref={menuButtonRef} type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#F5F2EA] text-[#1A1A1A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A] md:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((value) => !value)}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      {open ? <div id="mobile-nav" className="border-t border-[#1A1A1A]/20 bg-[#CBD2C4] md:hidden"><nav className="mx-auto flex max-w-[1200px] flex-col gap-1 px-4 py-4 sm:px-6" aria-label="Mobile">{NAV.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={isActive(pathname, item.href) ? "page" : undefined} className={cn("min-h-11 rounded-[8px] px-3 py-3 text-sm font-medium", isActive(pathname, item.href) ? "bg-[#1A1A1A] text-[#F5F2EA]" : "text-[#1A1A1A] hover:bg-[#F5F2EA]/70")}>{item.label}</Link>)}<div className="mt-3 flex flex-col gap-2 border-t border-[#1A1A1A]/20 pt-4"><ConnectWalletButton fullWidth /><Link href="/check" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center justify-center rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#F5F2EA] px-7 text-base font-semibold text-[#1A1A1A]">Move Money</Link></div></nav></div> : null}
    </header>
  );
}
