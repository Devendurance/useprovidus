import type { Metadata } from "next";
import { Suspense } from "react";
import { ReceiptClient } from "./receipt-client";

export const metadata: Metadata = {
  title: "Payment proof",
  description:
    "Owner-scoped payment receipts across BOT Chain and Celo.",
};

export default function ReceiptPage() {
  return (
    <Suspense fallback={null}>
      <ReceiptClient />
    </Suspense>
  );
}
