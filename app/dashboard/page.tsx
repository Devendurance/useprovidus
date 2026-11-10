import type { Metadata } from "next";
import { History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { RouteCheckCTA } from "@/components/ui/route-check-cta";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { EXECUTION_DOMAINS } from "@/lib/product/positioning";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Providus turns approved messages into verified payments across supported Celo and BOT Chain flows.",
};

export default function DashboardPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      {/* Page Header */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="font-proof text-receipt-grey">Your payment workspace</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
            Ask. Approve. Prove.
          </h1>
          <p className="mt-3 text-receipt-grey leading-relaxed">
            Providus turns approved messages into verified real-world payments.
            Describe a supported Nigerian service or ask to pay a named recipient
            on BOT Chain Mainnet. Your wallet approves the exact terms.
          </p>
          <div className="mt-5 rounded-[10px] border border-ledger-edge bg-receipt-field p-3.5">
            <p className="font-proof text-xs font-semibold text-ledger-stone">
              Supported airtime example
            </p>
            <p className="mt-1 font-display text-sm font-semibold text-ledger-stone">
              ₦1,000 MTN airtime for *******6560
            </p>
            <p className="mt-1 font-proof text-[11px] leading-relaxed text-receipt-grey">
              Celo mainnet · NGN delivered · Airtime delivered · Receipt
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <ConnectWalletButton />
          <RouteCheckCTA />
        </div>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-2" aria-label="Supported execution networks">
        {EXECUTION_DOMAINS.map((domain) => (
          <Card key={domain.id} variant="flat">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-proof text-[11px] font-semibold uppercase tracking-[0.12em] text-receipt-grey">
                  {domain.id === "bot" ? "Pay people on-chain" : "Pay for real-world services"}
                </p>
                <CardTitle className="mt-2 text-lg">{domain.name}</CardTitle>
              </div>
              <span className="shrink-0 rounded-full border border-ledger-edge bg-receipt-field px-2.5 py-1 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-provident-green">
                {domain.label}
              </span>
            </div>
            <CardDescription className="mt-3">{domain.summary}</CardDescription>
            <p className="mt-3 font-proof text-xs leading-5 text-receipt-grey">
              {domain.network} · {domain.assets}
            </p>
            <p className="mt-2 text-xs leading-5 text-receipt-grey">{domain.boundary}</p>
          </Card>
        ))}
      </section>

      {/* Providus Conversational Assistant Island */}
      <section className="mt-10" aria-label="Conversational assistant">
        <div className="mb-4">
          <p className="font-proof text-receipt-grey">Start with a message</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ledger-stone">
            Providus Assistant
          </h2>
          <p className="mt-1 text-sm text-receipt-grey leading-relaxed">
             Describe a Celo service or a BOT Chain Mainnet recipient payment, review
             the exact details, and approve in your connected wallet.
          </p>
        </div>

        <AssistantPanel />
      </section>

      <section className="mt-10" aria-labelledby="payment-journey-title">
        <div className="mb-4">
          <p className="font-proof text-receipt-grey">What happens next</p>
          <h2
            id="payment-journey-title"
            className="mt-1 font-display text-2xl font-semibold tracking-tight text-ledger-stone"
          >
            Conversation to payment to receipt
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card variant="flat">
            <p className="font-proof text-xs font-semibold text-provident-green">01 · Conversation</p>
            <CardTitle className="mt-2 text-base">Say what you need</CardTitle>
            <CardDescription>
              Ask for a supported service or name a recipient in plain language.
              Providus turns the message into payment details you can review.
            </CardDescription>
          </Card>
          <Card variant="flat">
            <p className="font-proof text-xs font-semibold text-provident-green">02 · Payment</p>
            <CardTitle className="mt-2 text-base">Approve the exact amount</CardTitle>
            <CardDescription>
              Check the recipient, network, asset, amount and expiry. Your
              connected wallet signs the exact transfer; Providus never takes
              custody of your funds.
            </CardDescription>
          </Card>
          <Card variant="flat">
            <p className="font-proof text-xs font-semibold text-provident-green">03 · Receipt</p>
            <CardTitle className="mt-2 text-base">See verified delivery</CardTitle>
            <CardDescription>
              We keep on-chain confirmation, settlement and service delivery
              separate, then show a receipt only for stages we can verify.
            </CardDescription>
          </Card>
        </div>
        <p className="mt-4 rounded-[10px] border border-ledger-edge bg-receipt-field px-3 py-2.5 text-sm leading-relaxed text-receipt-grey">
          LLM owns language. Deterministic code owns money.
        </p>
      </section>

      {/* Payment History & Ledger Guidance */}
      <section className="mt-14" aria-label="Payment history">
        <div className="mb-4">
          <p className="font-proof text-receipt-grey">Payment records across supported flows</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ledger-stone">
            Payment History
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <EmptyState
            variant="surface"
            icon={<History className="h-5 w-5" />}
            title="No payment history yet"
            description="Verified BOT recipient payments, airtime and cash-out records will appear here. Start in the assistant or open the cash-out flow to review the exact payment and create a receipt. Providus shows only payment evidence it can verify."
            action={
              <RouteCheckCTA emphasis="flat" />
            }
          />

          <aside className="space-y-4">
            <Card variant="flat">
              <CardTitle className="text-base">What will appear</CardTitle>
              <CardDescription>
                Your verified payment records and receipts.
              </CardDescription>
              <ul className="mt-3 space-y-2 text-sm text-receipt-grey">
                <li>Airtime delivery entries</li>
                <li>Cash-out entries</li>
                <li>Recipient and quote evidence</li>
                <li>Celo and BOT Chain payment states</li>
                <li>Receipts only for verified results</li>
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
