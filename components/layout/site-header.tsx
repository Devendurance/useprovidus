"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/check", label: "Move Money" },
  { href: "/receipt", label: "Receipt" },
  { href: "/dashboard", label: "Dashboard" },
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

  return (
    <header className="sticky top-0 z-40 border-b border-ink/20 bg-sage/95 backdrop-blur-sm">
      <div
        className={cn(
          "container-providus flex min-h-20 items-center justify-between gap-4 py-3",
          pathname === "/" && "container-providus-home",
        )}
      >
        <Link
          href="/"
          className="group shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={() => setOpen(false)}
        >
          <span className="font-brand text-[1.35rem] font-bold uppercase leading-none tracking-[0.06em] text-ink">
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
              className={cn(
                "rounded-[8px] px-3 py-2 text-sm font-medium tracking-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                isActive(pathname, item.href)
                  ? "bg-ink text-cream"
                  : "text-ink/75 hover:bg-cream/70 hover:text-ink",
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
            className="inline-flex h-11 min-h-11 items-center justify-center rounded-[8px] border-[1.5px] border-ink bg-cream px-5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Move Money
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] border-[1.5px] border-ink bg-cream text-ink md:hidden"
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
          className="border-t border-ink/20 bg-sage md:hidden"
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
                className={cn(
                  "min-h-11 rounded-[8px] px-3 py-3 text-sm font-medium",
                  isActive(pathname, item.href)
                    ? "bg-ink text-cream"
                    : "text-ink hover:bg-cream/70",
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-ink/20 pt-4">
              <ConnectWalletButton fullWidth />
              <Link
                href="/check"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 min-h-11 items-center justify-center rounded-[8px] border-[1.5px] border-ink bg-cream px-7 text-base font-semibold text-ink transition-colors hover:bg-ink hover:text-cream"
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
