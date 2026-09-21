import type { Metadata } from "next";
import { Suspense } from "react";
import { Lock, ArrowLeft } from "lucide-react";
import { RouteStepper } from "@/components/providus/route-stepper";
import { ValueLine } from "@/components/providus/value-line";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { PreviewQuerySummary } from "@/components/check/preview-query-summary";

export const metadata: Metadata = {
  title: "Bank cash-out review",
  description:
    "A truthful placeholder for an active Providus bank cash-out review.",
};

export default function CheckPreviewPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="font-proof text-receipt-grey">Review not started</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          No active bank cash-out review
        </h1>
        <p className="mt-3 text-receipt-grey leading-relaxed">
          This page only displays a review when a bank cash-out session has supplied
          a current quote and verified bank recipient. No amount, provider or
          settlement result is being invented here.
        </p>
      </div>

      <RouteStepper current="preview" className="mt-8" />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-6">
          <Suspense
            fallback={
              <Card variant="flat">
                <CardTitle className="text-base">Your inputs</CardTitle>
                <CardDescription>Loading inputs…</CardDescription>
              </Card>
            }
          >
            <PreviewQuerySummary />
          </Suspense>

          <EmptyState
            variant="surface"
            icon={<Lock className="h-5 w-5" />}
            title="Start bank cash-out"
            description="Enter a Celo USDC amount, choose a Nigerian bank account and request a current Paycrest quote before reviewing the transfer."
            action={
              <LinkButton href="/check" variant="ghost" size="md">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Start cash-out
              </LinkButton>
            }
          />

          <Card variant="verdict" className="opacity-95">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-proof text-receipt-grey">Payment path</p>
                <CardTitle className="mt-1">Structure only</CardTitle>
              </div>
              <span className="rounded-full border border-ledger-edge bg-receipt-field px-3 py-1 font-proof text-[12px] text-receipt-grey">
                LOCKED
              </span>
            </div>
            <div className="mt-5">
              <ValueLine compact />
            </div>
            <CardDescription className="mt-5">
              Amounts, fees and estimated NGN receive appear only after a live
              quote is available. A quote is an estimate, not proof of bank
              delivery.
            </CardDescription>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card variant="flat">
            <CardTitle className="text-base">What review will show</CardTitle>
            <ul className="mt-3 space-y-2 text-sm text-receipt-grey">
              <li>Verified bank recipient and account name</li>
              <li>Current USDC amount, NGN estimate and fees</li>
              <li>Quote freshness, expiry and Celo network</li>
              <li>Explicit wallet approval before transfer</li>
            </ul>
            <div className="mt-5">
              <LinkButton href="/check" variant="ghost" size="md">
                Open bank cash-out
              </LinkButton>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
