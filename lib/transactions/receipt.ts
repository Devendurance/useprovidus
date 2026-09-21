import type { TransactionType } from "@/lib/transactions/types";

/**
 * A receipt is complete only when the terminal evidence matches the payment
 * path. Airtime requires fulfilment evidence; cash-out requires fiat delivery.
 */
export function isReceiptComplete(
  type: TransactionType | undefined,
  isFiatFinal: boolean | null | undefined,
  isAirtimeDelivered: boolean | null | undefined,
): boolean {
  if (type === "airtime") return Boolean(isAirtimeDelivered);
  if (type === "cash_out") return Boolean(isFiatFinal);
  return false;
}
