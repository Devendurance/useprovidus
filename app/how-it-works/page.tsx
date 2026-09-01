import type { Metadata } from "next";
import {
  ClipboardList,
  ScanSearch,
  Lock,
  Unlock,
  ExternalLink,
  Receipt,
} from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ValueLine } from "@/components/providus/value-line";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Providus Route Check compares local fiat-to-Celo routes by effective received amount—before you pay.",
};

const FLOW = [
  {
    title: "Describe the money move",
    body: "Select country, fiat amount, payment method and target Celo asset. These inputs decide which routes are eligible.",
    icon: ClipboardList,
  },
  {
    title: "Compare eligible routes",
    body: "Providus normalises supported paths by effective received amount, fees, FX spread, limits, settlement time and reliability—not by who appears first.",
    icon: ScanSearch,
  },
  {
    title: "Review a locked preview",
    body: "You see a useful preview of the comparison. Full provider detail, assumptions and handoff stay locked until a Route Check payment.",
    icon: Lock,
  },
  {
    title: "Unlock the Route Verdict",
    body: "A small x402 stablecoin payment unlocks the complete recommendation: what arrives, why it ranked first, alternatives and how to continue.",
    icon: Unlock,
  },
  {
    title: "Continue with the provider",
    body: "Open the provider deep link or follow clear manual instructions. Providus does not custody funds or execute the fiat purchase.",
    icon: ExternalLink,
  },
  {
    title: "Keep a savings receipt",
    body: "A timestamped receipt records the estimate and choice. It explains the outcome without exposing wallet balances or personal provider data.",
    icon: Receipt,
  },
] as const;

const VERDICT_FIELDS = [
  "Estimated received amount",
  "Target asset and route / provider",
  "Payment method",
  "Explicit fee and estimated FX spread",
  "Network cost where relevant",
  "Settlement range",
  "Reliability / quote confidence",
  "Eligibility and amount-limit caveats",
  "Quote capture time and expiry",
  "Estimated saving versus baseline",
  "Provider handoff",
  "Alternative eligible routes",
  "Transparent ranking rationale",
] as const;

export default function HowItWorksPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="font-proof text-receipt-grey">Route Check flow</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl lg:text-5xl">
          Show the outcome before the money moves.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-receipt-grey">
          Providus is a route-intelligence agent—not an on-ramp or wallet. It
          compares local routes into Celo by what you actually receive after
          fees, FX, limits and settlement time.
        </p>
      </div>

      <div className="mt-10 rounded-[14px] border-ledger bg-clear-paper p-6 shadow-elevated sm:p-8">
        <p className="mb-4 text-sm font-semibold text-ledger-stone">
          The Value Line
        </p>
        <ValueLine />
        <p className="mt-4 text-sm text-receipt-grey">
          Every preview, Route Verdict and savings receipt follows this
          structure. It is calculation logic—not decoration.
        </p>
      </div>

      <ol className="mt-12 grid gap-4 md:grid-cols-2">
        {FLOW.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title}>
              <Card variant="surface" className="h-full">
                <div className="mb-3 flex items-center gap-3">
                  <span className="font-proof text-provident-green">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border-ledger bg-receipt-field text-provident-green shadow-base">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                </div>
                <CardTitle>{step.title}</CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </Card>
            </li>
          );
        })}
      </ol>

      <section className="mt-14 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            What a full Route Verdict includes
          </h2>
          <p className="mt-3 text-receipt-grey leading-relaxed">
            No payment unlock is complete until the result includes an
            actionable route—not just an abstract score.
          </p>
          <ul className="mt-6 space-y-2">
            {VERDICT_FIELDS.map((field) => (
              <li
                key={field}
                className="flex items-start gap-2 text-sm text-ledger-stone"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-provident-green"
                  aria-hidden
                />
                {field}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <Card variant="standard">
            <CardTitle>Ranking policy</CardTitle>
            <CardDescription>
              Recommendations rank user outcome, never provider placement.
              Effective received amount carries the most weight, followed by
              fees, reliability, speed and a small Celo-native bonus.
            </CardDescription>
            <p className="mt-4 font-proof text-receipt-grey">
              Manual or estimated quotes are marked with source and capture
              time. Sponsored links cannot improve rank.
            </p>
          </Card>
          <Card variant="surface">
            <CardTitle>Boundaries</CardTitle>
            <ul className="mt-3 space-y-2 text-sm text-receipt-grey">
              <li>No custody of user funds</li>
              <li>No fiat purchase execution in MVP</li>
              <li>No claim of global coverage</li>
              <li>No stale quote presented as a final price</li>
            </ul>
          </Card>
        </div>
      </section>

      <div className="mt-14 flex flex-col items-start gap-4 rounded-[14px] border-ledger-thick bg-clear-paper p-6 shadow-prominent sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="font-display text-xl font-semibold tracking-tight">
            Check a route
          </p>
          <p className="mt-1 text-sm text-receipt-grey">
            Start with inputs. Live quotes and x402 unlock connect next.
          </p>
        </div>
        <LinkButton href="/check" variant="primary" size="lg">
          Check my route
        </LinkButton>
      </div>
    </div>
  );
}
