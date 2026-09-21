import type { Metadata } from "next";
import { Suspense } from "react";
import { ReceiptClient } from "./receipt-client";

export const metadata: Metadata = {
  title: "Payment proof",
  description:
    "A truthful proof surface for shipped airtime + cash-out payments.",
};

export default function ReceiptPage() {
  return (
    <Suspense fallback={null}>
      <ReceiptClient />
    </Suspense>
  );
}
