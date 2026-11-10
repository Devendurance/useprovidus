import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TokenApprovalCard, TokenApprovalStatus } from "@/components/assistant/token-approval-card";

const blocked = renderToStaticMarkup(<TokenApprovalCard enabled={false} reviewContextKey="blocked" onStateChange={() => {}} />);
assert.match(blocked, /unavailable for this payment/);
assert.doesNotMatch(blocked, /Approve exact allowance in wallet/);
const checking = renderToStaticMarkup(<TokenApprovalCard
  enabled
  plan={{} as never}
  client={{} as never}
  wallet={{} as never}
  revalidate={async () => {}}
  reviewContextKey="ready"
  onStateChange={() => {}}
/>);
assert.match(checking, /Checking token allowance/);
assert.doesNotMatch(checking, /Approve exact allowance in wallet/);
const confirming = renderToStaticMarkup(<TokenApprovalStatus enabled state="approval_confirming" />);
assert.match(confirming, /Payment has not been sent/);
const approved = renderToStaticMarkup(<TokenApprovalStatus enabled state="payment_ready" />);
assert.match(approved, /approve the payment separately/);
assert.doesNotMatch(approved, /Verified|completed|successful/i);
for (const state of ["checking_allowance", "approval_required", "awaiting_token_approval"] as const) {
  assert.match(renderToStaticMarkup(<TokenApprovalStatus enabled state={state} />), /role="status"/);
}
console.log("B7 ERC-20 UI gates and separate approval/payment states passed.");
