import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/check", label: "Move Money" },
  { href: "/receipt", label: "Savings receipt" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-ledger-edge bg-receipt-field">
      <div className="container-providus py-12 sm:py-16">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-[10px] border-ledger bg-provident-green text-xs font-bold text-white shadow-base"
                aria-hidden
              >
                P
              </span>
              <span className="font-display text-lg font-semibold tracking-tight">
                Providus
              </span>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-receipt-grey">
              The Celo route-intelligence agent for smarter on-ramp decisions.
              Compare local routes by what you actually receive—not the
              headline fee.
            </p>
            <p className="font-proof text-receipt-grey">
              pro-VEE-dus · from Latin providus: foreseeing, prudent, prepared
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-ledger-stone">
                Product
              </h2>
              <ul className="mt-3 space-y-2">
                {FOOTER_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-receipt-grey transition-colors hover:text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-sm font-semibold tracking-tight text-ledger-stone">
                Boundaries
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-receipt-grey">
                <li>No custody of user funds</li>
                <li>No fiat purchase execution</li>
                <li>Estimates, not guarantees</li>
                <li>You keep control of every transfer</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-ledger-edge pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-receipt-grey">
            Providus does not hold or move your funds. Route results are
            estimates with disclosed assumptions and freshness.
          </p>
          <p className="font-proof text-xs text-receipt-grey">
            Built for Celo · UI shell
          </p>
        </div>
      </div>
    </footer>
  );
}
