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
    "Providus turns approved messages into verified real-world payments.",
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
            Describe supported Nigerian airtime in the assistant, or move Celo
            USDC to a Nigerian bank account through cash-out.
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

      {/* Providus Conversational Assistant Island */}
      <section className="mt-10" aria-label="Conversational assistant">
        <div className="mb-4">
          <p className="font-proof text-receipt-grey">Start with a message</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ledger-stone">
            Providus Assistant
          </h2>
          <p className="mt-1 text-sm text-receipt-grey leading-relaxed">
            Describe the airtime you want, review the payment details, and
            approve the exact amount in your connected wallet.
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
              Ask for supported Nigerian airtime in plain language. Providus
              turns the message into payment details you can review.
            </CardDescription>
          </Card>
          <Card variant="flat">
            <p className="font-proof text-xs font-semibold text-provident-green">02 · Payment</p>
            <CardTitle className="mt-2 text-base">Approve the exact amount</CardTitle>
            <CardDescription>
              Check the recipient, network, current quote and expiry. Your
              connected wallet must approve the Celo USDC transfer; Providus
              never takes custody of your funds.
            </CardDescription>
          </Card>
          <Card variant="flat">
            <p className="font-proof text-xs font-semibold text-provident-green">03 · Receipt</p>
            <CardTitle className="mt-2 text-base">See verified delivery</CardTitle>
            <CardDescription>
              We keep Celo payment, NGN settlement and airtime delivery
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
          <p className="font-proof text-receipt-grey">Airtime and cash-out records</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ledger-stone">
            Payment History
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <EmptyState
            variant="surface"
            icon={<History className="h-5 w-5" />}
            title="No payment history yet"
            description="Verified airtime and cash-out payments will appear here. Start a supported airtime payment in the assistant or start a cash-out to review the payment details and create a receipt. Providus shows only payment evidence it can verify."
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
                <li>Celo payment and NGN settlement states</li>
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
