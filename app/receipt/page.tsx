import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { RouteStepper } from "@/components/providus/route-stepper";
import { ValueLine } from "@/components/providus/value-line";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";

export const metadata: Metadata = {
  title: "Savings receipt",
  description:
    "Complete a Route Check to get a timestamped savings receipt.",
};

export default function ReceiptPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="font-proof text-receipt-grey">Proof surface</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          Savings receipt
        </h1>
        <p className="mt-3 text-receipt-grey leading-relaxed">
          Complete a Route Check to get a savings receipt. Estimates only—never
          presented as a guaranteed saving.
        </p>
      </div>

      <RouteStepper current="receipt" className="mt-8" />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <EmptyState
          variant="surface"
          icon={<Receipt className="h-5 w-5" />}
          title="No receipt yet"
          description="Complete a Route Check to get a savings receipt. When available, it will show the estimated amount you kept, the path taken, and capture time—without wallet balances or provider personal data."
          action={
            <LinkButton href="/check" variant="primary" size="lg">
              Check my route
            </LinkButton>
          }
        />

        <Card variant="verdict" className="flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Receipt shell</CardTitle>
            <span className="rounded-full border border-ledger-edge bg-receipt-field px-3 py-1 font-proof text-[12px] text-receipt-grey">
              EMPTY
            </span>
          </div>
          <CardDescription className="mt-2">
            Structure for a shareable, data-minimised proof surface.
          </CardDescription>

          <div className="mt-8 rounded-[10px] border border-dashed border-ledger-edge bg-receipt-field px-4 py-8 text-center">
            <p className="font-display text-2xl font-semibold tracking-tight text-receipt-grey/80 sm:text-3xl">
              Estimated keep
            </p>
            <p className="mt-2 font-proof text-receipt-grey">
              — · no Route Check completed
            </p>
          </div>

          <div className="mt-6">
            <ValueLine compact />
          </div>

          <dl className="mt-6 grid gap-3 border-t border-ledger-edge pt-6 sm:grid-cols-2">
            {[
              "Path",
              "Capture time",
              "Quote state",
              "Baseline comparison",
            ].map((label) => (
              <div key={label}>
                <dt className="font-proof text-receipt-grey">{label}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-receipt-grey/70">
                  —
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
