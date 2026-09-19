import type { Metadata } from "next";
import {
  ClipboardList,
  ScanSearch,
  Lock,
  Unlock,
  ExternalLink,
  Receipt,
} from "lucide-react";
import { RouteCheckCTA } from "@/components/ui/route-check-cta";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ValueLine } from "@/components/providus/value-line";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Providus turns a reviewed Celo USDC payment into a Nigerian bank cash-out.",
};

const FLOW = [
  {
    title: "Choose the cash-out",
    body: "Start with a Celo USDC → Nigerian bank cash-out and enter the amount you want to send.",
    icon: ClipboardList,
  },
  {
    title: "Get a current quote",
    body: "Providus checks the live Paycrest corridor and shows the estimated NGN amount, rate and fees.",
    icon: ScanSearch,
  },
  {
    title: "Verify the recipient",
    body: "Select a Nigerian bank, enter the account number and confirm the returned account name before review.",
    icon: Lock,
  },
  {
    title: "Review and approve",
    body: "Check the recipient, total USDC, fees, quote freshness and expiry. Nothing moves until you confirm and sign.",
    icon: Unlock,
  },
  {
    title: "Deposit USDC on Celo",
    body: "Your wallet sends the exact total to the Paycrest order address. Providus does not custody your funds.",
    icon: ExternalLink,
  },
  {
    title: "Follow settlement",
    body: "Celo deposit confirmation is shown separately from Nigerian bank delivery. A deposit is not presented as payout completion.",
    icon: Receipt,
  },
] as const;

const VERDICT_FIELDS = [
  "Nigerian bank and verified account name",
  "USDC amount and estimated NGN receive",
  "Paycrest rate and separate fee lines",
  "Celo mainnet and canonical USDC",
  "Quote capture time and expiry",
  "Wallet approval boundary",
  "Celo deposit status",
  "Nigerian settlement status when available",
] as const;

export default function HowItWorksPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="font-proof text-receipt-grey">Providus payment flow</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl lg:text-5xl">
          Say the payment. Review it. Approve it. Prove the result.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-receipt-grey">
          Providus coordinates a Celo USDC cash-out to a Nigerian bank account
          through Paycrest. You see the exact details before signing, and the
          app keeps Celo confirmation separate from Nigerian settlement.
        </p>
      </div>

      <div className="mt-10 rounded-[14px] border-ledger bg-clear-paper p-6 shadow-elevated sm:p-8">
        <p className="mb-4 text-sm font-semibold text-ledger-stone">
          The Value Line
        </p>
        <ValueLine />
        <p className="mt-4 text-sm text-receipt-grey">
          The value line keeps the amount, fees and expected receive visible
          through review. It is a payment summary—not a promise of settlement.
        </p>
      </div>

      <h2 className="sr-only">The cash-out steps</h2>
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
                <CardTitle as="h3">{step.title}</CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </Card>
            </li>
          );
        })}
      </ol>

      <section className="mt-14 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            What a safe review includes
          </h2>
          <p className="mt-3 text-receipt-grey leading-relaxed">
            Approval is only safe when the action and its limits are visible,
            not hidden behind provider or protocol language.
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
            <CardTitle as="h3">Quote policy</CardTitle>
            <CardDescription>
              The current quote is an estimate from Paycrest. Providus shows
              the returned amount and fee inputs directly so you can decide
              before approving the Celo transfer.
            </CardDescription>
            <p className="mt-4 font-proof text-receipt-grey">
              The quote includes a capture time and expiry. Refresh it when it
              is stale; do not treat an old quote as a final payout amount.
            </p>
          </Card>
          <Card variant="surface">
            <CardTitle as="h3">Settlement boundary</CardTitle>
            <ul className="mt-3 space-y-2 text-sm text-receipt-grey">
              <li>No custody of user funds</li>
              <li>Celo deposit is not Nigerian bank delivery</li>
              <li>No completion label before verified finality</li>
              <li>No stale quote presented as a final price</li>
            </ul>
          </Card>
        </div>
      </section>

      <div className="mt-14 flex flex-col items-start gap-4 rounded-[14px] border-ledger-thick bg-clear-paper p-6 shadow-prominent sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="font-display text-xl font-semibold tracking-tight">
            Cash out to a bank account
          </p>
          <p className="mt-1 text-sm text-receipt-grey">
            Start with a live quote, verify the recipient, then approve the
            exact Celo USDC transfer.
          </p>
        </div>
        <RouteCheckCTA />
      </div>
    </div>
  );
}
