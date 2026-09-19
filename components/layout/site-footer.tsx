import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/check", label: "Move Money" },
  { href: "/receipt", label: "Payment receipt" },
  { href: "/dashboard", label: "Payment history" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto flex min-h-[calc(100svh-81px)] items-center border-t border-[#1A1A1A]/20 bg-[#CBD2C4]">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6 sm:py-16 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4"><span className="font-brand text-xl font-bold uppercase leading-none tracking-[0.06em] text-[#1A1A1A]">Providus</span><p className="max-w-md text-sm leading-relaxed text-[#1A1A1A]/70">A Celo-native Nigerian payments agent. Turn Celo USDC into a reviewed bank cash-out, with approval and settlement states kept visible.</p><p className="font-proof text-[#1A1A1A]/65">pro-VEE-dus · from Latin providus: foreseeing, prudent, prepared</p></div>
          <div className="grid gap-8 sm:grid-cols-2"><div><h2 className="text-sm font-semibold tracking-tight text-[#1A1A1A]">Product</h2><ul className="mt-3 space-y-2">{FOOTER_LINKS.map((link) => <li key={link.href}><Link href={link.href} className="text-sm text-[#1A1A1A]/70 transition-colors hover:text-[#1A1A1A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A]">{link.label}</Link></li>)}</ul></div><div><h2 className="text-sm font-semibold tracking-tight text-[#1A1A1A]">Boundaries</h2><ul className="mt-3 space-y-2 text-sm text-[#1A1A1A]/70"><li>No custody of user funds</li><li>No wallet custody or silent approval</li><li>Celo deposit is not bank delivery</li><li>Estimates, not guarantees</li><li>You keep control of every transfer</li></ul></div></div>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-[#1A1A1A]/20 pt-6 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-[#1A1A1A]/65">Providus does not hold or move your funds. Payment quotes are estimates with disclosed assumptions and freshness.</p><p className="font-proof text-xs text-[#1A1A1A]/65">Built for Celo · UI shell</p></div>
      </div>
    </footer>
  );
}
