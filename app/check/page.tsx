import type { Metadata } from "next";
import { MoveMoneyPanel } from "@/components/move/move-money-panel";

export const metadata: Metadata = {
  title: "Move Money",
  description:
    "Cash out Celo USDC to a verified Nigerian bank account through Paycrest.",
};

export default function MoveMoneyPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="font-proof text-receipt-grey">Providus · Move Money</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          Move Celo USDC to a Nigerian bank account
        </h1>
        <p className="mt-3 text-receipt-grey leading-relaxed">
          Review a live Paycrest quote, verify the recipient and approve the
          exact Celo USDC transfer yourself. Quotes are time-sensitive; Celo
          confirmation does not by itself prove Nigerian bank delivery.
        </p>
      </div>

      <div className="mt-10">
        <MoveMoneyPanel />
      </div>
    </div>
  );
}
