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
    title: "Name the payment",
    message:
      "Start with the Nigerian bank cash-out you want to make from your Celo USDC.",
    proof: "Amount, recipient and current quote stay visible.",
    icon: Eye,
  },
  {
    title: "Review before approval",
    message:
      "See the recipient, fees, exchange rate, expiry and total USDC before money moves.",
    proof: "No silent wallet approval or hidden settlement step.",
    icon: MapPinned,
  },
  {
    title: "Approve on Celo",
    message:
      "You explicitly sign the exact Celo USDC transfer to the Paycrest order.",
    proof: "Providus never takes custody of your funds.",
    icon: Coins,
  },
  {
    title: "Track what happened",
    message:
      "Celo confirmation and Nigerian bank settlement are separate stages.",
    proof: "A deposit confirmation is not presented as payout completion.",
    icon: ShieldCheck,
  },
  {
    title: "Keep the proof",
    message:
      "Providus is building durable records for approved Nigerian payments.",
    proof: "History and final receipts arrive only when the result is verified.",
    icon: LineChart,
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "State the payment",
    body: "Choose a Celo USDC cash-out and enter the amount you want to send.",
  },
  {
    n: "02",
    title: "Verify the recipient",
    body: "Select a Nigerian bank and confirm the account name before review.",
  },
  {
    n: "03",
    title: "Review and approve",
    body: "Check the live quote, fees, expiry and total, then sign in your wallet.",
  },
  {
    n: "04",
    title: "Follow settlement",
    body: "Celo confirms the deposit first; Nigerian bank delivery is tracked separately.",
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
              Celo-native Nigerian payments agent
            </p>
            <h1 className="font-display text-[2.75rem] font-semibold leading-[0.98] tracking-[-0.04em] text-ledger-stone sm:text-5xl lg:text-[4.5rem] lg:tracking-[-0.055em]">
              Turn Celo stablecoins into everyday Nigerian payments.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-receipt-grey">
              Providus turns an approved Celo USDC payment into a reviewed
              Nigerian bank cash-out, with the recipient, quote and approval
              boundary visible before anything moves.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <LinkButton href="/check" variant="primary" size="lg">
                Start a cash-out
                <ArrowRight className="h-4 w-4" aria-hidden />
              </LinkButton>
              <LinkButton href="/how-it-works" variant="ghost" size="lg">
                How it works
              </LinkButton>
            </div>
            <p className="max-w-lg text-sm text-receipt-grey">
              Start with a Celo USDC → Nigerian bank cash-out through Paycrest.
              Quotes are time-sensitive estimates, not guarantees.
            </p>
          </div>

          <div
            className="relative rounded-[14px] border-ledger-thick bg-clear-paper p-6 shadow-prominent sm:p-8"
            style={{ borderTopRightRadius: "120px" }}
          >
            <p className="font-proof text-receipt-grey">Value Line</p>
            <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ledger-stone sm:text-3xl">
              See the payment details before the money moves.
            </p>
            <div className="mt-6">
              <ValueLine compact />
            </div>
            <p className="mt-6 text-sm leading-relaxed text-receipt-grey">
              The live Move Money flow fills this line with the current quote,
              fees, recipient and estimated NGN receive.
            </p>
            <div className="mt-6 border-t border-ledger-edge pt-4">
              <p className="text-sm font-semibold text-ledger-stone">
                Review the action. Then approve it yourself.
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
              Say the payment. Review it. Approve it. Prove the result.
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
                    <CardTitle as="h3">{pillar.title}</CardTitle>
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
              How a cash-out works
            </h2>
            <p className="mt-3 text-receipt-grey leading-relaxed">
              From intent to Celo confirmation—transparent at every step. No
              custody, silent approval, or invented settlement result.
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
                <li>Providus never approves or signs a transfer for you.</li>
                <li>
                  Quotes are estimates with freshness and assumptions—not final
                  prices.
                </li>
                <li>
                  Celo confirmation and Nigerian bank settlement are separate
                  states.
                </li>
              </ul>
            </div>
            <div className="rounded-[14px] border-2 border-receipt-field/30 bg-deep-provision/40 p-6 sm:p-8">
              <p className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                Ready to move money?
              </p>
              <p className="mt-3 text-sm leading-relaxed text-receipt-field/80">
                Cash out Celo USDC to a verified Nigerian bank account. Review
                the live quote before you approve the transfer.
              </p>
              <div className="mt-6">
                <Link
                  href="/check"
                  className="inline-flex h-[52px] items-center justify-center rounded-[10px] border-[2.5px] border-receipt-field bg-provident-green px-7 text-base font-semibold text-white shadow-[4px_4px_0_#F5F6F1] transition-[transform,box-shadow] duration-100 hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#F5F6F1]"
                >
                  Start a cash-out
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
