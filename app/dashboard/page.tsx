import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ReceiptText } from "lucide-react";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { EXECUTION_DOMAINS } from "@/lib/product/positioning";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Ask Providus to pay a BOT Chain recipient or use a supported Celo service, then review and approve each wallet action.",
};

export default function DashboardPage() {
  return (
    <div className="container-providus py-8 sm:py-10">
      <header className="max-w-3xl">
        <p className="font-proof text-sm text-receipt-grey">Your payment workspace</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          Ask. Approve. Prove.
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-receipt-grey">
          Ask to pay someone on BOT Chain or use a supported Celo service. Review the details, then approve each wallet action yourself.
        </p>
      </header>

      <section className="mt-6" aria-label="Supported payment networks">
        <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
          {EXECUTION_DOMAINS.map((domain) => (
            <li
              key={domain.id}
              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[10px] border border-ledger-edge bg-clear-paper px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="font-display text-sm font-semibold text-ledger-stone">{domain.name}</p>
                <p className="mt-0.5 font-proof text-xs leading-relaxed text-receipt-grey">
                  {domain.network} · {domain.assets}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-provident-green/35 bg-provident-green/10 px-2.5 py-1 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-deep-provision">
                {domain.label}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-7" aria-label="Conversational assistant">
        <AssistantPanel />
      </section>

      <section className="mt-8" aria-labelledby="dashboard-receipts-title">
        <div className="flex flex-col gap-4 rounded-[12px] border border-ledger-edge bg-receipt-field p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-provident-green" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="dashboard-receipts-title" className="font-display text-base font-semibold text-ledger-stone">
                Your payment records
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-receipt-grey">
                Open your receipt history for BOT Chain and supported Celo payments.
              </p>
            </div>
          </div>
          <Link
            href="/receipt"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-ledger bg-clear-paper px-4 font-display text-sm font-semibold text-ledger-stone transition-colors motion-reduce:transition-none hover:bg-ledger hover:text-clear-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            View receipts
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
