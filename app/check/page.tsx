import type { Metadata } from "next";
import { MoveMoneyPanel } from "@/components/move/move-money-panel";

export const metadata: Metadata = {
  title: "Bank cash-out",
  description:
    "A separate Celo USDC bank cash-out execution flow through Paycrest.",
};

export default function BankCashOutPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="font-proof text-receipt-grey">
          Providus · separate execution flow
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          Review a Celo USDC bank cash-out
        </h1>
        <p className="mt-3 text-receipt-grey leading-relaxed">
          This is Providus&apos;s separate bank cash-out flow. Verify the
          Nigerian recipient, review the current Paycrest quote and approve the
          exact Celo USDC transfer yourself. The conversational airtime flow
          starts in the web dashboard; here, Celo confirmation and Nigerian
          bank delivery remain separate states.
        </p>
      </div>

      <div className="mt-10">
        <MoveMoneyPanel />
      </div>
    </div>
  );
}
