import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { BOT_CHAIN_LINKS } from "@/lib/product/positioning";

const FOOTER_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/check", label: "Bank cash-out" },
  { href: "/receipt", label: "Receipts" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto flex min-h-[calc(100svh-81px)] items-center border-t border-[#1A1A1A]/20 bg-[#CBD2C4]">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6 sm:py-16 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <span className="font-brand text-xl font-bold uppercase leading-none tracking-[0.06em] text-[#1A1A1A]">
              Providus
            </span>
            <p className="max-w-md text-sm leading-relaxed text-[#1A1A1A]/70">
              A multichain conversational payment execution layer that turns
              user-approved requests into verified outcomes.
            </p>
            <p className="font-proof text-[#1A1A1A]/65">
              Ask. Approve. Prove.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-[#1A1A1A]">
                Explore
              </h2>
              <ul className="mt-3 space-y-2">
                {FOOTER_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-[#1A1A1A]/70 transition-colors hover:text-[#1A1A1A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-[#1A1A1A]">
                Boundaries
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-5 text-[#1A1A1A]/70">
                <li>Web dashboard is the current channel</li>
                <li>No custody or silent wallet approval</li>
                <li>Celo is live; BOT Testnet is verified</li>
                <li>BOT Chain mainnet is pending B9</li>
                <li>BOT-funded utilities need a verified settlement route</li>
                <li>Quotes are estimates with freshness and assumptions</li>
                <li>Future services are roadmap, not shipped</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 rounded-[8px] border-[1.5px] border-[#F5F2EA]/20 bg-[#1A1A1A] p-5 text-[#F5F2EA] sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div className="flex items-center gap-4">
            <Image
              src="/brand/bot-chain-official-logo.png"
              alt="BOT Chain"
              width={150}
              height={28}
              className="h-7 w-auto max-w-[150px]"
            />
            <p className="text-xs leading-5 text-[#F5F2EA]/70">
              Official ecosystem acknowledgment for the verified BOT Testnet payment path.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold sm:mt-0">
            <a
              href={BOT_CHAIN_LINKS.website}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[#F5F2EA]/40 underline-offset-4 hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#F5F2EA]"
            >
              BOT Chain website
            </a>
            <a
              href={BOT_CHAIN_LINKS.mainnetExplorer}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[#F5F2EA]/40 underline-offset-4 hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#F5F2EA]"
            >
              Official explorer
            </a>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-5 border-t border-[#1A1A1A]/20 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-5 text-[#1A1A1A]/65">
            Providus does not custody user funds. You approve the exact action,
            sign the exact transfer and receive evidence for the stages that can
            be verified.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] border-[1.5px] border-[#1A1A1A] bg-[#1A1A1A] px-5 py-2 text-sm font-semibold text-[#F5F2EA] transition-colors hover:bg-[#F5F2EA] hover:text-[#1A1A1A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A]"
          >
            Try Providus <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <p className="font-proof text-xs text-[#1A1A1A]/65">
            Built across Celo and BOT Chain · Ask. Approve. Prove.
          </p>
        </div>
      </div>
    </footer>
  );
}
