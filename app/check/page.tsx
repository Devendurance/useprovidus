import type { Metadata } from "next";
import { MoveMoneyPanel } from "@/components/move/move-money-panel";

export const metadata: Metadata = {
  title: "Move Money",
  description:
    "Live quotes for buying USDC on Celo with NGN or cashing out Celo USDC to NGN via Paycrest.",
};

export default function MoveMoneyPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-receipt-grey">
          Providus · Move Money
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          Know what arrives before you pay
        </h1>
        <p className="mt-4 max-w-xl text-receipt-grey leading-relaxed">
          Check a live Celo USDC route quote. Buy USDC (NGN → USDC) or cash out
          (USDC → NGN). Quotes are time-sensitive and do not move funds.
        </p>
      </div>

      <div className="relative mt-10 overflow-hidden rounded-[8px] border-ledger bg-receipt-field/70 p-1 sm:mt-12 sm:p-2">
        <div className="pointer-events-none absolute -right-28 -top-28 h-72 w-72 rounded-full border border-ledger-edge/70" aria-hidden />
        <MoveMoneyPanel />
      </div>
    </div>
  );
}
