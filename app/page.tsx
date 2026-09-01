import Link from "next/link";
import {
  Eye,
  MapPinned,
  ShieldCheck,
  Coins,
  LineChart,
  ArrowRight,
} from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ValueLine } from "@/components/providus/value-line";

const PILLARS = [
  {
    title: "See what arrives",
    message:
      "The best route is measured by effective received amount, not advertised fee.",
    proof: "Fee, FX spread, network cost, limits and estimated received.",
    icon: Eye,
  },
  {
    title: "Choose with context",
    message:
      "The right route changes by country, amount and payment method.",
    proof: "Localised inputs, provider eligibility and transparent ranking.",
    icon: MapPinned,
  },
  {
    title: "Pay only for a useful answer",
    message:
      "A small x402 payment unlocks a complete, actionable Route Verdict.",
    proof: "Locked preview, paid full breakdown and provider handoff.",
    icon: Coins,
  },
  {
    title: "Keep control",
    message:
      "Providus explains and recommends; you execute with your chosen provider.",
    proof: "No custody, no automated fiat purchase, clear handoff.",
    icon: ShieldCheck,
  },
  {
    title: "Improve with real use",
    message:
      "Route history and outcome feedback make later recommendations better.",
    proof: "Quote freshness, reliability tracking and savings history.",
    icon: LineChart,
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Enter your route",
    body: "Country, fiat amount, payment method and target asset.",
  },
  {
    n: "02",
    title: "See a locked preview",
    body: "A useful range of what may arrive—without inventing a final price.",
  },
  {
    n: "03",
    title: "Unlock the Route Verdict",
    body: "Pay a small Route Check fee for full breakdown and provider handoff.",
  },
  {
    n: "04",
    title: "Continue with the provider",
    body: "You keep control. Providus does not hold or move your funds.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="container-providus py-12 sm:py-16 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14">
          <div className="space-y-6">
            <p className="inline-flex items-center rounded-full border border-ledger-edge bg-clear-paper px-3 py-1 font-proof text-receipt-grey">
              Celo route-intelligence agent
            </p>
            <h1 className="font-display text-[2.75rem] font-semibold leading-[0.98] tracking-[-0.04em] text-ledger-stone sm:text-5xl lg:text-[4.5rem] lg:tracking-[-0.055em]">
              Know what arrives before you pay.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-receipt-grey">
              Providus compares local routes into Celo by what you actually
              receive after fees, FX, limits and settlement time.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <LinkButton href="/check" variant="primary" size="lg">
                Check my route
                <ArrowRight className="h-4 w-4" aria-hidden />
              </LinkButton>
              <LinkButton href="/how-it-works" variant="ghost" size="lg">
                How it works
              </LinkButton>
            </div>
            <p className="max-w-lg text-sm text-receipt-grey">
              The Celo route-intelligence agent for smarter on-ramp decisions.
              Estimates with disclosed assumptions—not guarantees.
            </p>
          </div>

          <div
            className="relative rounded-[14px] border-ledger-thick bg-clear-paper p-6 shadow-prominent sm:p-8"
            style={{ borderTopRightRadius: "120px" }}
          >
            <p className="font-proof text-receipt-grey">Value Line</p>
            <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ledger-stone sm:text-3xl">
              See the money outcome before the route is accepted.
            </p>
            <div className="mt-6">
              <ValueLine compact />
            </div>
            <p className="mt-6 text-sm leading-relaxed text-receipt-grey">
              Structure only—no live quote on this page. A Route Check fills
              this line with fees, FX, selected route and estimated receive.
            </p>
            <div className="mt-6 border-t border-ledger-edge pt-4">
              <p className="text-sm font-semibold text-ledger-stone">
                See what arrives. Then choose the route.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-y border-ledger-edge bg-clear-paper/60 py-14 sm:py-16">
        <div className="container-providus">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ledger-stone sm:text-[1.75rem]">
              Prudence in motion
            </h2>
            <p className="mt-3 text-receipt-grey leading-relaxed">
              Show the outcome before the money moves. Five principles guide
              every Route Check.
            </p>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <li key={pillar.title}>
                  <Card variant="surface" className="h-full">
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[10px] border-ledger bg-receipt-field text-provident-green shadow-base">
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <CardTitle>{pillar.title}</CardTitle>
                    <CardDescription>{pillar.message}</CardDescription>
                    <p className="mt-3 font-proof text-receipt-grey">
                      {pillar.proof}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* How it works teaser */}
      <section className="container-providus py-14 sm:py-16">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ledger-stone sm:text-[1.75rem]">
              How a Route Check works
            </h2>
            <p className="mt-3 text-receipt-grey leading-relaxed">
              From inputs to handoff—transparent at every step. No custody. No
              hidden ranking for affiliates.
            </p>
          </div>
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1 text-sm font-semibold text-provident-green hover:text-deep-provision focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green"
          >
            Full explanation
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="rounded-[14px] border-ledger bg-clear-paper p-5 shadow-elevated"
            >
              <span className="font-proof text-provident-green">{step.n}</span>
              <h3 className="mt-2 font-display text-lg font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-receipt-grey">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Boundaries + CTA */}
      <section className="border-t border-ledger-edge bg-ledger-stone py-14 text-receipt-field sm:py-16">
        <div className="container-providus">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
                Product boundaries
              </h2>
              <ul className="mt-6 space-y-3 text-sm leading-relaxed text-receipt-field/85">
                <li>Providus does not custody user funds.</li>
                <li>Providus does not execute fiat purchases in the MVP.</li>
                <li>
                  Quotes are estimates with freshness and assumptions—not final
                  prices.
                </li>
                <li>
                  Affiliate placement is never a ranking signal. You keep
                  control.
                </li>
              </ul>
            </div>
            <div className="rounded-[14px] border-2 border-receipt-field/30 bg-deep-provision/40 p-6 sm:p-8">
              <p className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                Ready to compare a route?
              </p>
              <p className="mt-3 text-sm leading-relaxed text-receipt-field/80">
                Start a Route Check. Preview structure is ready; live quotes and
                x402 unlock connect next.
              </p>
              <div className="mt-6">
                <Link
                  href="/check"
                  className="inline-flex h-[52px] items-center justify-center rounded-[10px] border-[2.5px] border-receipt-field bg-provident-green px-7 text-base font-semibold text-white shadow-[4px_4px_0_#F5F6F1] transition-[transform,box-shadow] duration-100 hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#F5F6F1]"
                >
                  Check my route
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
