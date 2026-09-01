import type { Metadata } from "next";
import { History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Your Route Check history. No checks yet—start one to see history here.",
};

export default function DashboardPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="font-proof text-receipt-grey">History</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
            Dashboard
          </h1>
          <p className="mt-3 text-receipt-grey leading-relaxed">
            Thin history of Route Checks and receipts. Improve later
            recommendations with real use—once storage is connected.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ConnectWalletButton />
          <LinkButton href="/check" variant="primary" size="md">
            Check my route
          </LinkButton>
        </div>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <EmptyState
          variant="surface"
          icon={<History className="h-5 w-5" />}
          title="No route checks yet"
          description="No route checks yet. Check a route to see history here. When connected, each row will show capture time, path and estimated keep—never fake balances or invented providers."
          action={
            <LinkButton href="/check" variant="primary" size="lg">
              Check my route
            </LinkButton>
          }
        />

        <aside className="space-y-4">
          <Card variant="flat">
            <CardTitle className="text-base">What will appear</CardTitle>
            <CardDescription>
              After Route Checks are stored, expect:
            </CardDescription>
            <ul className="mt-3 space-y-2 text-sm text-receipt-grey">
              <li>Timestamped Route Check entries</li>
              <li>Selected route labels (not balances)</li>
              <li>Estimated keep language, marked as estimate</li>
              <li>Links back to receipt shells you own</li>
            </ul>
          </Card>
          <Card variant="standard">
            <CardTitle className="text-base">Keep control</CardTitle>
            <CardDescription>
              Providus does not custody funds. History is for your decisions—not
              a portfolio dashboard.
            </CardDescription>
          </Card>
        </aside>
      </div>
    </div>
  );
}
