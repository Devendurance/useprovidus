import assert from "node:assert/strict";
import { isReceiptComplete } from "@/lib/transactions/receipt";

assert.equal(
  isReceiptComplete("airtime", true, false),
  false,
  "airtime must remain incomplete while fulfilment is pending",
);
assert.equal(
  isReceiptComplete("airtime", true, true),
  true,
  "airtime completes only after fulfilment delivery evidence",
);
assert.equal(
  isReceiptComplete("cash_out", true, false),
  true,
  "cash-out completes on authoritative fiat delivery",
);
assert.equal(
  isReceiptComplete("cash_out", false, true),
  false,
  "cash-out does not use an airtime fulfilment flag",
);

console.log("receipt completion self-check: all assertions passed");
