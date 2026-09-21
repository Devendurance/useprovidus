import type { Metadata } from "next";
import { FileSearch } from "lucide-react";
import { RouteStepper } from "@/components/providus/route-stepper";
import { ValueLine } from "@/components/providus/value-line";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";

export const metadata: Metadata = {
  title: "Bank cash-out review",
  description:
    "The bank cash-out review is available from an active Providus session.",
};

const REQUIRED_FIELDS = [
  { label: "Estimated NGN receive", hint: "Current Paycrest quote" },
  { label: "Celo USDC total", hint: "Amount plus returned fees" },
  { label: "Verified bank recipient", hint: "Institution and account name" },
  { label: "Celo network", hint: "Mainnet · chain 42220" },
  { label: "Quote freshness", hint: "Capture time and expiry" },
  { label: "Wallet approval", hint: "Explicit signature required" },
  { label: "Celo deposit", hint: "On-chain confirmation" },
  { label: "Nigerian payout", hint: "Shown only after finality" },
] as const;

export default function CheckVerdictPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="font-proof text-receipt-grey">Review unavailable</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          No active bank cash-out review
        </h1>
        <p className="mt-3 text-receipt-grey leading-relaxed">
          Providus only shows a review after a live quote and verified Nigerian
          bank recipient are available. Start from Bank cash-out to create that
          state; this URL never fabricates an amount, provider or result.
        </p>
      </div>

      <RouteStepper current="verdict" className="mt-8" />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <div className="space-y-6">
          <EmptyState
            variant="surface"
            icon={<FileSearch className="h-5 w-5" />}
            title="Review is not ready"
            description="No active cash-out session was found. Enter an amount, request a current Paycrest quote and verify the recipient before approving a Celo USDC transfer."
            action={
              <LinkButton href="/check" variant="ghost" size="md">
                Open bank cash-out
              </LinkButton>
            }
          />

          <Card variant="verdict">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-proof text-receipt-grey">Bank cash-out review</p>
                <CardTitle className="mt-1">No review to display</CardTitle>
              </div>
              <span className="rounded-full border border-ledger-edge bg-receipt-field px-3 py-1 font-proof text-[12px] text-receipt-grey">
                NOT AVAILABLE
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {REQUIRED_FIELDS.map((field) => (
                <div
                  key={field.label}
                  className="rounded-[10px] border border-ledger-edge bg-receipt-field px-3 py-3"
                >
                  <p className="text-sm font-semibold text-ledger-stone">
                    {field.label}
                  </p>
                  <p className="mt-1 font-proof text-[12px] text-receipt-grey">
                    {field.hint}
                  </p>
                  <p className="mt-2 font-proof text-receipt-grey/70">—</p>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <p className="mb-3 text-sm font-semibold text-ledger-stone">
                Payment path
              </p>
              <ValueLine compact />
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-ledger-edge pt-6 sm:flex-row sm:items-center">
              <p className="rounded-[10px] border border-ledger-edge bg-receipt-field px-3 py-3 text-sm font-semibold text-ledger-stone">
                Bank payout status appears after a verified payment
              </p>
              <p className="text-sm text-receipt-grey">
                The Celo deposit and Nigerian bank settlement are separate
                states. Providus does not label a deposit as delivery.
              </p>
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card variant="surface">
            <CardTitle>What review requires</CardTitle>
            <CardDescription>
              A current quote, a verified Nigerian bank recipient, a Celo wallet
              on mainnet and enough USDC for the exact total.
            </CardDescription>
            <div className="mt-5">
              <LinkButton href="/check" variant="ghost" size="md" fullWidth>
                Start cash-out
              </LinkButton>
            </div>
          </Card>

          <Card variant="flat">
            <CardTitle className="text-base">Settlement boundary</CardTitle>
            <CardDescription>
              Celo confirms the on-chain deposit first. Paycrest bank delivery
              needs its own finality check before Providus can call it complete.
            </CardDescription>
          </Card>

          <LinkButton href="/receipt" variant="ghost" size="md" fullWidth>
            View receipt status
          </LinkButton>
        </aside>
      </div>
    </div>
  );
}
