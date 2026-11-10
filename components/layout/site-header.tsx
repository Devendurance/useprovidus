"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/#networks", label: "Networks" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/check", label: "Bank cash-out" },
  { href: "/receipt", label: "Receipts" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/check") {
    return pathname === "/check" || pathname.startsWith("/check/");
  }
  return href === "/#networks" ? false : pathname === href;
}

function focusableItems(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);



  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog?.open) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    const previousBodyStyle = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    const previousHtmlOverflow = html.style.overflow;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => focusableItems(dialog)[0]?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      body.style.position = previousBodyStyle.position;
      body.style.top = previousBodyStyle.top;
      body.style.width = previousBodyStyle.width;
      body.style.overflow = previousBodyStyle.overflow;
      html.style.overflow = previousHtmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  const closeMenu = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = focusableItems(dialog);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-ink/20 bg-sage pt-[env(safe-area-inset-top)]">
      <div
        className={cn(
          "container-providus flex min-h-16 items-center justify-between gap-4 py-2 md:min-h-20 md:py-3",
          pathname === "/" && "container-providus-home",
        )}
      >
        <Link
          href="/"
          className="group shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="font-brand text-[1.3rem] font-bold uppercase leading-none tracking-[0.06em] text-ink md:text-[1.35rem]">
            Providus
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
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

        <div className="hidden items-center gap-3 lg:flex">
          <ConnectWalletButton />
          <Link
            href="/dashboard"
            className="inline-flex h-11 min-h-11 items-center justify-center rounded-[8px] border-[1.5px] border-ink bg-ink px-5 text-sm font-semibold text-cream transition-colors hover:bg-cream hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Try Providus
          </Link>
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] border-[1.5px] border-ink bg-cream text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav-dialog"
          aria-haspopup="dialog"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      <dialog
        id="mobile-nav-dialog"
        ref={dialogRef}
        aria-label="Site navigation"
        onCancel={(event) => { event.preventDefault(); closeMenu(); }}
        onClose={() => toggleRef.current?.focus()}
        onClick={(event) => { if (event.target === event.currentTarget) closeMenu(); }}
        onKeyDown={handleDialogKeyDown}
        className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-0 text-ink backdrop:bg-ink/45 lg:hidden"
      >
        <div className="min-h-0 border-b border-ink/20 bg-sage pt-[env(safe-area-inset-top)] shadow-xl">
          <div className="container-providus flex min-h-16 items-center justify-between gap-4 border-b border-ink/15 py-2">
            <span className="font-brand text-[1.3rem] font-bold uppercase leading-none tracking-[0.06em] text-ink">Providus</span>
            <button type="button" aria-label="Close navigation menu" onClick={closeMenu} className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] border border-ink bg-cream text-ink hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <nav className="container-providus flex flex-col gap-1 py-4" aria-label="Mobile">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className={cn(
                  "flex min-h-12 items-center rounded-[8px] px-3 py-3 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
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
                href="/dashboard"
                onClick={closeMenu}
                className="inline-flex h-11 min-h-11 items-center justify-center rounded-[8px] border-[1.5px] border-ink bg-ink px-7 text-base font-semibold text-cream transition-colors hover:bg-cream hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Try Providus
              </Link>
            </div>
          </nav>
        </div>
      </dialog>
    </header>
  );
}
