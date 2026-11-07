import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TokenApprovalCard, TokenApprovalStatus } from "@/components/assistant/token-approval-card";

const blocked = renderToStaticMarkup(<TokenApprovalCard enabled={false} />);
assert.match(blocked, /disabled=""/);
assert.match(blocked, /disabled until B9/);
assert.match(blocked, /never unlimited allowance/);
const confirming = renderToStaticMarkup(<TokenApprovalStatus enabled state="approval_confirming" />);
assert.match(confirming, /Payment has not been sent/);
const approved = renderToStaticMarkup(<TokenApprovalStatus enabled state="payment_ready" />);
assert.match(approved, /approve the payment separately/);
assert.doesNotMatch(approved, /Verified|completed|successful/i);
for (const state of ["checking_allowance", "approval_required", "awaiting_token_approval"] as const) {
  assert.match(renderToStaticMarkup(<TokenApprovalStatus enabled state={state} />), /role="status"/);
}
console.log("B7 ERC-20 UI gates and separate approval/payment states passed.");
