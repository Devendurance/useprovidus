import type { Metadata } from "next";
import { Suspense } from "react";
import { Lock, ArrowLeft } from "lucide-react";
import { RouteStepper } from "@/components/providus/route-stepper";
import { ValueLine } from "@/components/providus/value-line";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";
import { PreviewQuerySummary } from "@/components/check/preview-query-summary";

export const metadata: Metadata = {
  title: "Route preview",
  description:
    "Locked Route Check preview. Full verdict unlocks after payment.",
};

export default function CheckPreviewPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-receipt-grey">
          Locked preview
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          Route comparison preview
        </h1>
        <p className="mt-4 max-w-xl text-receipt-grey leading-relaxed">
          Preview will appear here once route comparison is connected. No
          estimate to show yet.
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
            title="No live preview yet"
            description="Preview will appear here once route comparison is connected. No estimate to show yet. Saving range, routes compared and quote freshness stay empty until the quote API is wired."
            action={
              <LinkButton href="/check" variant="ghost" size="md">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Edit inputs
              </LinkButton>
            }
          />

          <Card variant="verdict" className="opacity-95">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-proof text-receipt-grey">Value Line</p>
                <CardTitle className="mt-1">Structure only</CardTitle>
              </div>
              <span className="rounded-full border border-ledger-edge bg-receipt-field px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-receipt-grey">
                LOCKED
              </span>
            </div>
            <div className="mt-5">
              <ValueLine compact />
            </div>
            <CardDescription className="mt-5">
              Amounts, fees and receive figures appear after a connected quote
              comparison—never invented for display.
            </CardDescription>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card variant="surface">
            <CardTitle>Unlock full route</CardTitle>
            <CardDescription>
              A small x402 payment unlocks the complete Route Verdict. Payment
              and quote unlock are not connected yet.
            </CardDescription>
            <div className="mt-5 space-y-3">
              <Button type="button" variant="primary" fullWidth disabled>
                Unlock full route — coming soon
              </Button>
              <ConnectWalletButton fullWidth label="Connect wallet to pay" />
              <p className="text-sm text-receipt-grey">
                Full Route Verdict unlocks after a Route Check payment.
                Functionality is not connected yet.
              </p>
            </div>
          </Card>

          <Card variant="flat">
            <CardTitle className="text-base">What unlocks</CardTitle>
            <ul className="mt-3 space-y-2 text-sm text-receipt-grey">
              <li>Recommended route and estimated receive</li>
              <li>Fee, FX, limits, settlement, reliability</li>
              <li>Alternatives and ranking rationale</li>
              <li>Continue with provider handoff</li>
            </ul>
            <div className="mt-5">
              <LinkButton href="/check/verdict" variant="ghost" size="md">
                View verdict shell
              </LinkButton>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
