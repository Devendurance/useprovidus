import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/check", label: "Move Money" },
  { href: "/receipt", label: "Savings receipt" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto flex min-h-[var(--viewport-content-height)] items-center border-t border-ink/20 bg-sage">
      <div className="container-providus w-full py-12 sm:py-16">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-brand text-xl font-bold uppercase leading-none tracking-[0.06em]">
                Providus
              </span>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-ink/70">
              The Celo route-intelligence agent for smarter on-ramp decisions.
              Compare local routes by what you actually receive—not the
              headline fee.
            </p>
            <p className="font-proof text-ink/65">
              pro-VEE-dus · from Latin providus: foreseeing, prudent, prepared
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-ink">
                Product
              </h2>
              <ul className="mt-3 space-y-2">
                {FOOTER_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink/70 transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-sm font-semibold tracking-tight text-ink">
                Boundaries
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-ink/70">
                <li>No custody of user funds</li>
                <li>No fiat purchase execution</li>
                <li>Estimates, not guarantees</li>
                <li>You keep control of every transfer</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink/20 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink/65">
            Providus does not hold or move your funds. Route results are
            estimates with disclosed assumptions and freshness.
          </p>
          <p className="font-proof text-xs text-ink/65">
            Built for Celo · UI shell
          </p>
        </div>
      </div>
    </footer>
  );
}
