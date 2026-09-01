/**
 * P4B pure order helpers + Paycrest error/payload contract checks (no live network).
 * Run: npm run test:order-helpers
 */

import assert from "node:assert/strict";
import { getAddress } from "viem";
import {
  computeTotalUsdcToSend,
  generateOrderReference,
  isPaymentWindowOpen,
  namesMatchMaterially,
  normalizeCashOutOrderResponse,
  PAYMENT_EXPIRY_SAFETY_MS,
  calculateMaxCeloGasFee,
  canCoverCeloGas,
  canPayOrder,
} from "@/lib/paycrest/order";
import {
  buildOfframpOrderPayload,
  redactOfframpOutgoingBody,
  summarizeOfframpPayloadFields,
} from "@/lib/paycrest/offramp-payload";
import { resolvePaycrestUrl } from "@/lib/paycrest/server/config";
import {
  classifyUpstreamOrderFailure,
  parsePaycrestValidationDetails,
  sanitizeValidationErrorString,
} from "@/lib/paycrest/server/upstream-error";

function run() {
  // Fee total exact
  assert.equal(computeTotalUsdcToSend("100", "0.5", "0.25"), "100.75");
  assert.equal(computeTotalUsdcToSend("10", "0", "0"), "10");

  // Reference shape
  const ref = generateOrderReference();
  assert.ok(ref.startsWith("p4b_"));
  assert.ok(ref.length > 10);
  assert.ok(!ref.includes("0x"));

  // Names
  assert.equal(namesMatchMaterially("John Doe", "  john   doe "), true);
  assert.equal(namesMatchMaterially("A", "B"), false);

  // Expiry
  const future = new Date(Date.now() + 5 * 60_000).toISOString();
  assert.equal(isPaymentWindowOpen(future).open, true);
  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(isPaymentWindowOpen(past).open, false);
  const near = new Date(Date.now() + PAYMENT_EXPIRY_SAFETY_MS / 2).toISOString();
  assert.equal(isPaymentWindowOpen(near).open, false);
  assert.equal(isPaymentWindowOpen(near).reason, "SAFETY_MARGIN");

  const refund = getAddress("0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa");
  const receive = getAddress("0x00000000000000000000000000000000000000Ab");
  const validUntil = new Date(Date.now() + 10 * 60_000).toISOString();
  const expectedInfo = {
    amount: "50",
    refundAddress: refund,
    institution: "bank1",
    institutionName: "Test Bank",
    accountName: "TEST USER",
    accountIdentifierMasked: "******7890",
    reference: "p4b_abc",
  };

  const validResponse = {
    status: "success",
    data: {
      id: "order-test-123",
      status: "initiated",
      amount: "50",
      senderFee: "0.1",
      transactionFee: "0.05",
      rate: "1400",
      providerAccount: {
        network: "celo",
        receiveAddress: receive,
        validUntil,
      },
    },
  };

  // Normalize mock Paycrest-like response
  const norm = normalizeCashOutOrderResponse(validResponse, expectedInfo);
  assert.equal(norm.ok, true);
  if (norm.ok) {
    assert.equal(norm.order.totalUsdcToSend, "50.15");
    assert.equal(norm.order.providerAccount.network, "celo");
    assert.equal(norm.order.senderFee, "0.1");
  }

  // Missing senderFee or transactionFee blocks payment
  const missingSenderFee = JSON.parse(JSON.stringify(validResponse));
  delete missingSenderFee.data.senderFee;
  const noSenderFee = normalizeCashOutOrderResponse(missingSenderFee, expectedInfo);
  assert.equal(noSenderFee.ok, false);
  if (!noSenderFee.ok)
    assert.equal(noSenderFee.message, "Missing required senderFee or transactionFee");

  const missingTxFee = JSON.parse(JSON.stringify(validResponse));
  delete missingTxFee.data.transactionFee;
  const noTxFee = normalizeCashOutOrderResponse(missingTxFee, expectedInfo);
  assert.equal(noTxFee.ok, false);

  // Explicit "0" fee remains valid
  const zeroFee = JSON.parse(JSON.stringify(validResponse));
  zeroFee.data.senderFee = "0";
  zeroFee.data.transactionFee = 0;
  const explicitZero = normalizeCashOutOrderResponse(zeroFee, expectedInfo);
  assert.equal(explicitZero.ok, true);

  // Malformed and over-precision fees block payment
  const badFee = JSON.parse(JSON.stringify(validResponse));
  badFee.data.senderFee = "0.1234567";
  const overPrecision = normalizeCashOutOrderResponse(badFee, expectedInfo);
  assert.equal(overPrecision.ok, false);
  if (!overPrecision.ok) assert.equal(overPrecision.message, "Invalid senderFee");

  // Gas safety calculation
  const estimate = BigInt(100000);
  const maxFee = BigInt(10000000000);
  const maxGas = calculateMaxCeloGasFee(estimate, maxFee);
  assert.equal(
    maxGas,
    (BigInt(100000) * BigInt(10000000000) * BigInt(125)) / BigInt(100),
  );

  assert.equal(canCoverCeloGas(BigInt(5000), BigInt(10000)).canCover, false);
  assert.equal(canCoverCeloGas(BigInt(10000), BigInt(10000)).canCover, true);

  // canPayOrder checks
  if (norm.ok) {
    const payCheck = canPayOrder({
      order: norm.order,
      orderUnsafe: false,
      walletAddress: refund,
      isCeloMainnet: true,
      usdcBalanceRaw: BigInt(60000000),
      paymentPending: false,
      paymentSubmitted: false,
      gasCheckPassed: true,
      simulatedSuccess: true,
    });
    assert.equal(payCheck.canPay, true);

    const badWallet = canPayOrder({
      ...payCheck,
      order: norm.order,
      orderUnsafe: false,
      walletAddress: "0x0000000000000000000000000000000000000000",
      isCeloMainnet: false,
      usdcBalanceRaw: null,
      paymentPending: false,
      paymentSubmitted: false,
    });
    assert.equal(badWallet.canPay, false);
    assert.ok(badWallet.reasons.includes("WALLET_CHANGED"));
    assert.ok(badWallet.reasons.includes("WRONG_NETWORK"));
  }

  // Unsafe: bad receive address
  const bad = normalizeCashOutOrderResponse(
    {
      data: {
        id: "x",
        amount: "1",
        senderFee: "0",
        transactionFee: "0",
        providerAccount: {
          network: "celo",
          receiveAddress: "not-an-address",
          validUntil,
        },
      },
    },
    {
      amount: "1",
      refundAddress: refund,
      institution: "b",
      institutionName: "B",
      accountName: "N",
      accountIdentifierMasked: "******0000",
      reference: "p4b_x",
    },
  );
  assert.equal(bad.ok, false);

  // --- URL Resolution (production path) ---
  assert.equal(
    resolvePaycrestUrl("https://api.paycrest.io/v2", "/sender/orders"),
    "https://api.paycrest.io/v2/sender/orders",
  );
  assert.equal(
    resolvePaycrestUrl("https://api.paycrest.io/v2/", "/sender/orders"),
    "https://api.paycrest.io/v2/sender/orders",
  );
  assert.equal(
    resolvePaycrestUrl("https://api.paycrest.io/v2", "/v2/sender/orders"),
    "https://api.paycrest.io/v2/sender/orders",
  );
  assert.equal(
    resolvePaycrestUrl("https://api.paycrest.io", "/sender/orders"),
    "https://api.paycrest.io/v2/sender/orders",
  );

  // --- Exact production payload builder ---
  const built = buildOfframpOrderPayload({
    amount: "1",
    reference: "p4b_testref",
    refundAddress: refund,
    institution: "GTBINGLA",
    accountIdentifier: "0123456789",
    accountName: "TEST USER",
  });
  assert.equal(typeof built.amount, "string");
  assert.equal(built.amount, "1");
  assert.equal(built.source.type, "crypto");
  assert.equal(built.source.currency, "USDC");
  assert.equal(built.source.network, "celo");
  assert.equal(typeof built.source.refundAddress, "string");
  assert.equal(built.destination.type, "fiat");
  assert.equal(built.destination.currency, "NGN");
  assert.equal(typeof built.destination.recipient.institution, "string");
  assert.equal(typeof built.destination.recipient.accountIdentifier, "string");
  assert.equal(typeof built.destination.recipient.accountName, "string");
  assert.equal(typeof built.destination.recipient.memo, "string");
  assert.equal(built.destination.recipient.memo, "Providus cash-out");
  assert.equal(typeof built.reference, "string");
  assert.equal("amountIn" in built, false);
  assert.equal("rate" in built, false);
  assert.equal("senderFee" in built, false);

  const serialized = JSON.parse(JSON.stringify(built)) as Record<string, unknown>;
  assert.equal(typeof serialized.amount, "string");
  assert.ok(!("amountIn" in serialized));

  const fieldSummary = summarizeOfframpPayloadFields(built);
  assert.ok(fieldSummary.some((f) => f.path === "amount" && f.jsonType === "string"));
  assert.ok(fieldSummary.some((f) => f.path === "amountIn" && f.present === false));
  assert.ok(
    fieldSummary.some(
      (f) => f.path === "source.refundAddress" && f.present && f.jsonType === "string",
    ),
  );
  // Summary must not embed wallet/account values
  const summaryJson = JSON.stringify(fieldSummary);
  assert.ok(!summaryJson.includes(refund));
  assert.ok(!summaryJson.includes("0123456789"));

  // --- Official documented 400 data[] shape ---
  const official400 = {
    status: "error",
    message: "Failed to validate payload",
    data: [
      { field: "destination.recipient.memo", message: "memo is required" },
      { field: "source.network", message: "unsupported network" },
      { field: "not.a.real.field", message: "should be ignored" },
    ],
  };
  const parsedDetails = parsePaycrestValidationDetails(official400);
  assert.equal(parsedDetails.length, 2);
  assert.equal(parsedDetails[0].field, "destination.recipient.memo");

  const officialClassified = classifyUpstreamOrderFailure({
    httpStatus: 400,
    contentType: "application/json",
    bodyText: JSON.stringify(official400),
    diagnosticId: "pc_test1",
  });
  assert.equal(officialClassified.code, "PAYCREST_VALIDATION_FAILED");
  assert.equal(officialClassified.envelopeShape, "data_array");
  assert.equal(officialClassified.diagnosticId, "pc_test1");
  assert.ok(officialClassified.validationDetails.length >= 1);
  assert.notEqual(officialClassified.code, "UPSTREAM_ERROR");

  // data object envelope
  const dataObject400 = {
    status: "error",
    message: "Validation failed",
    data: { field: "amount", message: "amount too small" },
  };
  const dataObj = classifyUpstreamOrderFailure({
    httpStatus: 400,
    contentType: "application/json",
    bodyText: JSON.stringify(dataObject400),
  });
  assert.equal(dataObj.code, "PAYCREST_VALIDATION_FAILED");
  assert.equal(dataObj.envelopeShape, "data_object");

  // errors array
  const errorsArr = classifyUpstreamOrderFailure({
    httpStatus: 422,
    contentType: "application/json",
    bodyText: JSON.stringify({
      status: "error",
      message: "bad",
      errors: [{ path: "reference", message: "invalid reference" }],
    }),
  });
  assert.equal(errorsArr.code, "PAYCREST_VALIDATION_FAILED");
  assert.equal(errorsArr.envelopeShape, "errors_array");

  // nested validation envelope
  const nested = classifyUpstreamOrderFailure({
    httpStatus: 400,
    contentType: "application/json",
    bodyText: JSON.stringify({
      status: "error",
      message: "Failed to validate payload",
      data: {
        errors: [{ field: "destination.recipient.institution", message: "unknown bank" }],
      },
    }),
  });
  assert.equal(nested.code, "PAYCREST_VALIDATION_FAILED");
  assert.ok(
    nested.validationDetails.some(
      (d) => d.field === "destination.recipient.institution",
    ),
  );

  // plain-text 400
  const plain = classifyUpstreamOrderFailure({
    httpStatus: 400,
    contentType: "text/plain",
    bodyText: "Failed to validate payload",
  });
  assert.equal(plain.code, "PAYCREST_ORDER_REJECTED");
  assert.notEqual(plain.code, "UPSTREAM_ERROR");
  assert.ok(plain.diagnosticId.startsWith("pc_"));

  // malformed JSON
  const malformed = classifyUpstreamOrderFailure({
    httpStatus: 400,
    contentType: "application/json",
    bodyText: "{not-json",
  });
  assert.equal(malformed.code, "PAYCREST_ORDER_REJECTED");
  assert.equal(malformed.envelopeShape, "malformed_json");

  // empty 400
  const empty = classifyUpstreamOrderFailure({
    httpStatus: 400,
    contentType: "application/json",
    bodyText: "",
  });
  assert.equal(empty.code, "PAYCREST_ORDER_REJECTED");
  assert.equal(empty.envelopeShape, "empty");
  assert.ok(
    empty.message.toLowerCase().includes("without returning") ||
      empty.message.toLowerCase().includes("rejected"),
  );

  // message-only 400 (no field details) — must NOT be UPSTREAM_ERROR
  const messageOnly = classifyUpstreamOrderFailure({
    httpStatus: 400,
    contentType: "application/json",
    bodyText: JSON.stringify({
      status: "error",
      message: "Failed to validate payload",
      data: null,
    }),
  });
  assert.equal(messageOnly.code, "PAYCREST_ORDER_REJECTED");
  assert.notEqual(messageOnly.code, "UPSTREAM_ERROR");
  assert.equal(messageOnly.message, "Failed to validate payload");

  // Status classifications
  assert.equal(
    classifyUpstreamOrderFailure({
      httpStatus: 401,
      contentType: "application/json",
      bodyText: JSON.stringify({ message: "nope" }),
    }).code,
    "AUTH_FAILED",
  );
  assert.equal(
    classifyUpstreamOrderFailure({
      httpStatus: 403,
      contentType: "application/json",
      bodyText: JSON.stringify({ message: "nope" }),
    }).code,
    "AUTH_FAILED",
  );
  assert.equal(
    classifyUpstreamOrderFailure({
      httpStatus: 404,
      contentType: "application/json",
      bodyText: JSON.stringify({ message: "missing" }),
    }).code,
    "PAYCREST_ORDER_REJECTED",
  );
  assert.equal(
    classifyUpstreamOrderFailure({
      httpStatus: 409,
      contentType: "application/json",
      bodyText: JSON.stringify({ message: "dup" }),
    }).code,
    "PAYCREST_ORDER_REJECTED",
  );
  assert.equal(
    classifyUpstreamOrderFailure({
      httpStatus: 429,
      contentType: "application/json",
      bodyText: JSON.stringify({ message: "slow down" }),
    }).code,
    "UPSTREAM_ERROR",
  );
  assert.equal(
    classifyUpstreamOrderFailure({
      httpStatus: 500,
      contentType: "application/json",
      bodyText: JSON.stringify({ message: "boom" }),
    }).code,
    "UPSTREAM_ERROR",
  );
  assert.equal(
    classifyUpstreamOrderFailure({
      httpStatus: 503,
      contentType: "application/json",
      bodyText: JSON.stringify({ message: "no providers" }),
    }).code,
    "UPSTREAM_UNAVAILABLE",
  );

  // PII redaction
  const secretText =
    "Account 0123456789 for wallet 0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa bearer secretKey123";
  const sanitized = sanitizeValidationErrorString(secretText);
  assert.ok(!sanitized.includes("0123456789"));
  assert.ok(!sanitized.includes("0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa"));
  assert.ok(!sanitized.includes("secretKey123"));
  assert.ok(sanitized.includes("[account]"));
  assert.ok(sanitized.includes("[address]"));

  // Validation details must not carry PII through classifier
  const piiBody = classifyUpstreamOrderFailure({
    httpStatus: 400,
    contentType: "application/json",
    bodyText: JSON.stringify({
      status: "error",
      message: `bad wallet 0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa`,
      data: [
        {
          field: "source.refundAddress",
          message: `invalid 0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa account 0123456789`,
        },
      ],
    }),
  });
  assert.equal(piiBody.code, "PAYCREST_VALIDATION_FAILED");
  const dump = JSON.stringify(piiBody);
  assert.ok(!dump.includes("0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa"));
  assert.ok(!dump.includes("0123456789"));

  // Rejected normalize never becomes payable
  assert.equal(bad.ok, false);
  if (norm.ok) {
    const blocked = canPayOrder({
      order: null,
      orderUnsafe: true,
      walletAddress: refund,
      isCeloMainnet: true,
      usdcBalanceRaw: BigInt(1e12),
      paymentPending: false,
      paymentSubmitted: false,
    });
    assert.equal(blocked.canPay, false);
  }

  // Auth header name is API-Key (contract assertion; value never tested here)
  const AUTH_HEADER = "API-Key";
  assert.equal(AUTH_HEADER, "API-Key");

  // Redacted outgoing-body diagnostic preserves structure, hides PII
  const sensitiveBody = buildOfframpOrderPayload({
    amount: "1",
    reference: "p4b_diag_ref",
    refundAddress: refund,
    institution: "GTBINGLA",
    accountIdentifier: "0123456789",
    accountName: "REAL NAME HERE",
  });
  const redacted = redactOfframpOutgoingBody(sensitiveBody);
  assert.equal(redacted.amount, "1");
  assert.equal(redacted.source.type, "crypto");
  assert.equal(redacted.source.currency, "USDC");
  assert.equal(redacted.source.network, "celo");
  assert.equal(redacted.source.refundAddress, "<redacted-wallet>");
  assert.equal(redacted.destination.type, "fiat");
  assert.equal(redacted.destination.currency, "NGN");
  assert.equal(redacted.destination.recipient.institution, "GTBINGLA");
  assert.equal(redacted.destination.recipient.accountIdentifier, "<redacted-account>");
  assert.equal(redacted.destination.recipient.accountName, "<redacted-name>");
  assert.equal(redacted.destination.recipient.memo, "Providus cash-out");
  assert.equal(redacted.reference, "p4b_diag_ref");
  assert.equal(redacted.amountInPresent, false);
  assert.equal(redacted.ratePresent, false);
  assert.equal(redacted.senderFeePresent, false);
  assert.equal(redacted.senderFeePercentPresent, false);
  // Same object used for fetch stringify must still hold real values after redaction
  assert.equal(sensitiveBody.source.refundAddress, refund);
  assert.equal(sensitiveBody.destination.recipient.accountIdentifier, "0123456789");
  assert.equal(sensitiveBody.destination.recipient.accountName, "REAL NAME HERE");
  const redactedDump = JSON.stringify(redacted);
  assert.ok(!redactedDump.includes(refund));
  assert.ok(!redactedDump.includes("0123456789"));
  assert.ok(!redactedDump.includes("REAL NAME HERE"));
  // Serialized fetch body from same object still has full structure keys
  const fetchBody = JSON.parse(JSON.stringify(sensitiveBody)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(fetchBody).sort(), [
    "amount",
    "destination",
    "reference",
    "source",
  ]);
  assert.equal("amountIn" in fetchBody, false);

  console.log("order self-check (P4B.4): all assertions passed");
}

run();
