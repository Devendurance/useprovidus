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
  if (href === "/check") {
    return pathname === "/check" || pathname.startsWith("/check/");
  }
  return pathname === href;
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
    <header className="sticky top-0 z-40 border-b border-ledger-edge bg-receipt-field/95 backdrop-blur-sm">
      <a
        href="#main-content"
        className="sr-only absolute left-3 top-3 z-50 rounded-[8px] bg-clear-paper px-3 py-2 text-sm font-semibold text-ledger-stone shadow-base focus:not-sr-only focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-provident-green"
      >
        Skip to main content
      </a>
      <div className="container-providus flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="group flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green"
          onClick={() => setOpen(false)}
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[10px] border-ledger bg-provident-green text-sm font-bold text-white shadow-base"
            aria-hidden
          >
            P
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-ledger-stone">
            Providus
          </span>
        </Link>

        <nav
          className="hidden items-center gap-1 md:flex"
          aria-label="Primary"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cn(
                "rounded-[10px] px-3 py-2 text-sm font-semibold tracking-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green",
                isActive(pathname, item.href)
                  ? "bg-ledger-stone text-receipt-field"
                  : "text-receipt-grey hover:bg-ledger-edge/60 hover:text-ledger-stone",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ConnectWalletButton />
          <Link
            href="/check"
            className="inline-flex h-[44px] min-h-11 items-center justify-center rounded-[10px] border-ledger-thick bg-provident-green px-5 text-sm font-semibold text-white shadow-elevated transition-[transform,box-shadow,background-color] duration-100 hover:bg-deep-provision hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#18211F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green"
          >
            Move Money
          </Link>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] border-ledger bg-clear-paper shadow-base md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div
          id="mobile-nav"
          className="border-t border-ledger-edge bg-receipt-field md:hidden"
        >
          <nav
            className="container-providus flex flex-col gap-1 py-4"
            aria-label="Mobile"
          >
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={cn(
                  "rounded-[10px] px-3 py-3 text-sm font-semibold",
                  isActive(pathname, item.href)
                    ? "bg-ledger-stone text-receipt-field"
                    : "text-ledger-stone hover:bg-ledger-edge/60",
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-ledger-edge pt-4">
              <ConnectWalletButton fullWidth />
              <Link
                href="/check"
                onClick={() => setOpen(false)}
                className="inline-flex h-[52px] items-center justify-center rounded-[10px] border-ledger-thick bg-provident-green px-7 text-base font-semibold text-white shadow-elevated"
              >
                Move Money
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
