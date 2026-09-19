import type { Metadata } from "next";
import { History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { RouteCheckCTA } from "@/components/ui/route-check-cta";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";
import { AssistantPanel } from "@/components/assistant/assistant-panel";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Your Providus payment history and conversational intent assistant.",
};

export default function DashboardPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      {/* Page Header */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="font-proof text-receipt-grey">Value ledger & intents</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
            Dashboard
          </h1>
          <p className="mt-3 text-receipt-grey leading-relaxed">
            Durable payment history is not connected yet. Start a Celo USDC
            cash-out from Move Money; this page will show verified payment
            evidence when storage and settlement reconciliation are available.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ConnectWalletButton />
          <RouteCheckCTA />
        </div>
      </div>

      {/* Providus Conversational Assistant Island */}
      <section className="mt-10" aria-label="Conversational assistant">
        <div className="mb-4">
          <p className="font-proof text-receipt-grey">Intent & status engine</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ledger-stone">
            Providus Assistant
          </h2>
          <p className="mt-1 text-sm text-receipt-grey leading-relaxed">
            Draft a target airtime payment intent or ask about a transaction stage.
          </p>
        </div>

        <AssistantPanel />
      </section>

      {/* Payment History & Ledger Guidance */}
      <section className="mt-14" aria-label="Payment history">
        <div className="mb-4">
          <p className="font-proof text-receipt-grey">Settlement records</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ledger-stone">
            Payment History
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <EmptyState
            variant="surface"
            icon={<History className="h-5 w-5" />}
            title="No payment history yet"
            description="No verified Providus cash-outs are stored in this browser. Start a cash-out to review a live quote and approve the exact Celo transfer. History will not be fabricated from wallet balances or provider guesses."
            action={
              <RouteCheckCTA emphasis="flat" />
            }
          />

          <aside className="space-y-4">
            <Card variant="flat">
              <CardTitle className="text-base">What will appear</CardTitle>
              <CardDescription>
                After durable transaction storage is connected, expect:
              </CardDescription>
              <ul className="mt-3 space-y-2 text-sm text-receipt-grey">
                <li>Timestamped cash-out entries</li>
                <li>Recipient and quote evidence</li>
                <li>Celo deposit and Nigerian settlement states</li>
                <li>Receipts only for verified terminal results</li>
              </ul>
            </Card>
            <Card variant="standard">
              <CardTitle className="text-base">Keep control</CardTitle>
              <CardDescription>
                Providus does not custody funds. History is payment evidence for
                your decisions—not a portfolio or balance dashboard.
              </CardDescription>
            </Card>
          </aside>
        </div>
      </section>
    </div>
  );
}
