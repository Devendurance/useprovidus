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
        <p className="font-proof text-receipt-grey">Providus · Move Money</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          Know what arrives before you pay
        </h1>
        <p className="mt-3 text-receipt-grey leading-relaxed">
          Check a live Celo USDC route quote. Buy USDC (NGN → USDC) or cash out
          (USDC → NGN). Quotes are time-sensitive and do not move funds.
        </p>
      </div>

      <div className="mt-10">
        <MoveMoneyPanel />
      </div>
    </div>
  );
}
