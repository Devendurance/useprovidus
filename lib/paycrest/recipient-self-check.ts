/**
 * P4A pure recipient / readiness tests (no network).
 * Run: npm run test:recipient-helpers
 */

import assert from "node:assert/strict";
import {
  evaluateCashOutReviewReadiness,
  filterNgnBankInstitutions,
  isQuoteFresh,
  isVerificationBoundToSelection,
  maskAccountIdentifier,
  validateInstitutionCode,
  validateNgnAccountIdentifier,
} from "@/lib/paycrest/recipient";

function run() {
  // Account validation — preserve leading zeroes as string
  const leading = validateNgnAccountIdentifier("0123456789");
  assert.equal(leading.ok, true);
  if (leading.ok) assert.equal(leading.data, "0123456789");

  assert.equal(validateNgnAccountIdentifier("123456789").ok, false);
  assert.equal(validateNgnAccountIdentifier("12345678901").ok, false);
  assert.equal(validateNgnAccountIdentifier("12345abcde").ok, false);
  assert.equal(validateNgnAccountIdentifier("1234567890").ok, true);

  // Masking
  assert.equal(maskAccountIdentifier("0123456789"), "******6789");
  assert.equal(maskAccountIdentifier("1234567890"), "******7890");

  // Institution filter / sort
  const mixed = [
    { code: "b", name: "Beta Bank", type: "bank" },
    { code: "a", name: "Alpha Bank", type: "bank" },
    { code: "x", name: "Other", type: "mobile_money" },
  ];
  const banks = filterNgnBankInstitutions(mixed);
  assert.equal(banks.length, 2);
  assert.equal(banks[0].name, "Alpha Bank");
  assert.equal(banks[0].code, "a");

  const allow = validateInstitutionCode("a", banks);
  assert.equal(allow.ok, true);
  const deny = validateInstitutionCode("nope", banks);
  assert.equal(deny.ok, false);

  // Binding
  const verified = {
    institution: "a",
    accountIdentifier: "0123456789",
    accountName: "TEST USER",
    institutionName: "Alpha Bank",
    verifiedAt: new Date().toISOString(),
  };
  assert.equal(
    isVerificationBoundToSelection(verified, "a", "0123456789"),
    true,
  );
  assert.equal(
    isVerificationBoundToSelection(verified, "b", "0123456789"),
    false,
  );
  assert.equal(
    isVerificationBoundToSelection(verified, "a", "0123456780"),
    false,
  );

  // Quote freshness
  const now = Date.now();
  assert.equal(isQuoteFresh(new Date(now - 10_000).toISOString(), now), true);
  assert.equal(isQuoteFresh(new Date(now - 120_000).toISOString(), now), false);

  // Review readiness
  const ready = evaluateCashOutReviewReadiness({
    directionIsCashOut: true,
    walletReady: true,
    tokenCompatible: true,
    amountValid: true,
    quoteAvailable: true,
    quoteCheckedAt: new Date().toISOString(),
    balanceLoaded: true,
    balanceSufficient: true,
    institutionSelected: true,
    verificationBound: true,
    pendingRequest: false,
    quoteFresh: true,
  });
  assert.equal(ready.ready, true);

  const blocked = evaluateCashOutReviewReadiness({
    directionIsCashOut: true,
    walletReady: true,
    tokenCompatible: true,
    amountValid: true,
    quoteAvailable: true,
    quoteCheckedAt: new Date().toISOString(),
    balanceLoaded: true,
    balanceSufficient: false,
    institutionSelected: true,
    verificationBound: true,
    pendingRequest: false,
    quoteFresh: true,
  });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.reasons.includes("INSUFFICIENT_BALANCE"));

  const stale = evaluateCashOutReviewReadiness({
    directionIsCashOut: true,
    walletReady: true,
    tokenCompatible: true,
    amountValid: true,
    quoteAvailable: true,
    quoteCheckedAt: new Date().toISOString(),
    balanceLoaded: true,
    balanceSufficient: true,
    institutionSelected: true,
    verificationBound: true,
    pendingRequest: false,
    quoteFresh: false,
  });
  assert.ok(stale.reasons.includes("QUOTE_STALE"));

  // No order creation in pure helpers (smoke)
  assert.equal(typeof evaluateCashOutReviewReadiness, "function");

  console.log("recipient self-check (P4A): all assertions passed");
}

run();
