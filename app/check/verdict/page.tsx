import type { Metadata } from "next";
import { FileSearch } from "lucide-react";
import { RouteStepper } from "@/components/providus/route-stepper";
import { ValueLine } from "@/components/providus/value-line";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";

export const metadata: Metadata = {
  title: "Route Verdict",
  description:
    "Full Route Verdict shell. Unlocks after a paid Route Check.",
};

const REQUIRED_FIELDS = [
  { label: "Estimated received amount", hint: "Largest figure when unlocked" },
  { label: "Target asset", hint: "e.g. cUSD, USDC, CELO" },
  { label: "Provider / route", hint: "Selected path name" },
  { label: "Payment method", hint: "How you pay locally" },
  { label: "Total fee", hint: "Explicit fee breakdown" },
  { label: "Estimated FX spread", hint: "Assumptions disclosed" },
  { label: "Settlement range", hint: "Expected timing" },
  { label: "Reliability / confidence", hint: "With quote state" },
  { label: "Capture time & expiry", hint: "Freshness, never stale as final" },
  { label: "Saving vs baseline", hint: "Estimate language only" },
] as const;

export default function CheckVerdictPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-receipt-grey">
          Route Verdict
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          Best route for your money
        </h1>
        <p className="mt-4 max-w-xl text-receipt-grey leading-relaxed">
          Full Route Verdict unlocks after a Route Check payment. Functionality
          is not connected yet.
        </p>
      </div>

      <RouteStepper current="verdict" className="mt-8" />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <div className="space-y-6">
          <EmptyState
            variant="surface"
            icon={<FileSearch className="h-5 w-5" />}
            title="Verdict not unlocked"
            description="Full Route Verdict unlocks after a Route Check payment. Functionality is not connected yet. Required fields below show structure only—no fabricated amounts or providers."
            action={
              <LinkButton href="/check/preview" variant="ghost" size="md">
                Back to preview
              </LinkButton>
            }
          />

          <Card variant="verdict">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-proof text-receipt-grey">Recommended route</p>
                <CardTitle className="mt-1">Not available yet</CardTitle>
              </div>
              <span className="rounded-full border border-ledger-edge bg-receipt-field px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-receipt-grey">
                NOT UNLOCKED
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {REQUIRED_FIELDS.map((field) => (
                <div
                  key={field.label}
                  className="rounded-[8px] border border-ledger-edge bg-receipt-field px-3 py-3"
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
                Value Line
              </p>
              <ValueLine compact />
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-ledger-edge pt-6 sm:flex-row sm:items-center">
              <Button type="button" variant="primary" disabled>
                Continue with provider
              </Button>
              <p className="text-sm text-receipt-grey">
                Handoff enables after unlock. Providus does not hold or move
                your funds.
              </p>
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card variant="surface">
            <CardTitle>Alternatives</CardTitle>
            <CardDescription>
              Eligible alternatives appear here after unlock—ranked by outcome,
              never by placement.
            </CardDescription>
            <div className="mt-4 space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                    className="rounded-[8px] border border-dashed border-ledger-edge px-3 py-4 text-sm text-receipt-grey"
                >
                  Alternative route slot {i} — empty
                </div>
              ))}
            </div>
          </Card>

          <Card variant="flat">
            <CardTitle className="text-base">Unlock</CardTitle>
            <CardDescription>
              Connect a wallet when payment is enabled, then unlock the full
              verdict.
            </CardDescription>
            <div className="mt-4 space-y-3">
              <ConnectWalletButton fullWidth />
              <Button type="button" variant="secondary" fullWidth disabled>
                Unlock full route — coming soon
              </Button>
            </div>
          </Card>

          <LinkButton href="/receipt" variant="ghost" size="md" fullWidth>
            View receipt shell
          </LinkButton>
        </aside>
      </div>
    </div>
  );
}
