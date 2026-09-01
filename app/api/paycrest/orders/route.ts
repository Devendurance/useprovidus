import { getAddress, isAddress } from "viem";
import { validateUsdcAmount } from "@/lib/money/usdc-amount";
import {
  generateOrderReference,
  namesMatchMaterially,
  normalizeCashOutOrderResponse,
} from "@/lib/paycrest/order";
import {
  maskAccountIdentifier,
  validateInstitutionCode,
  validateNgnAccountIdentifier,
} from "@/lib/paycrest/recipient";
import {
  createOfframpOrder,
  listNgnBankInstitutions,
  verifyNgnAccountName,
} from "@/lib/paycrest/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 8_192;

export type OrderRouteErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_AMOUNT"
  | "INVALID_INSTITUTION"
  | "INVALID_ACCOUNT_IDENTIFIER"
  | "INVALID_REFUND_ADDRESS"
  | "RECIPIENT_VERIFICATION_FAILED"
  | "RECIPIENT_CHANGED"
  | "ORDER_RESPONSE_UNSAFE"
  | "ORDER_CREATION_OUTCOME_UNKNOWN"
  | "PAYCREST_AUTH_ERROR"
  | "PAYCREST_RATE_LIMITED"
  | "PAYCREST_VALIDATION_FAILED"
  | "PAYCREST_ORDER_REJECTED"
  | "PAYCREST_TIMEOUT"
  | "PAYCREST_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "CONFIGURATION_ERROR";

function err(
  code: OrderRouteErrorCode,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { ok: false, error: { code, message }, ...extra },
    { status, headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return err("INVALID_REQUEST", "Content-Type must be application/json", 415);
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return err("INVALID_REQUEST", "Could not read body", 400);
  }
  if (rawText.length > MAX_BODY_BYTES) {
    return err("INVALID_REQUEST", "Body too large", 413);
  }

  let body: unknown;
  try {
    body = rawText === "" ? null : JSON.parse(rawText);
  } catch {
    return err("INVALID_REQUEST", "Body must be valid JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return err("INVALID_REQUEST", "Body must be a JSON object", 400);
  }

  const rec = body as Record<string, unknown>;
  const allowed = new Set([
    "amount",
    "institution",
    "accountIdentifier",
    "refundAddress",
    "reviewedAccountName",
  ]);
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) {
      return err("INVALID_REQUEST", "Unexpected fields in request body", 400);
    }
  }

  if ("accountName" in rec || "memo" in rec) {
    return err(
      "INVALID_REQUEST",
      "accountName and memo must not be supplied as client input",
      400,
    );
  }

  const amountRaw = rec.amount;
  const institutionRaw = rec.institution;
  const accountRaw = rec.accountIdentifier;
  const refundRaw = rec.refundAddress;
  const reviewedName =
    typeof rec.reviewedAccountName === "string"
      ? rec.reviewedAccountName
      : null;

  if (
    typeof amountRaw !== "string" ||
    typeof institutionRaw !== "string" ||
    typeof accountRaw !== "string" ||
    typeof refundRaw !== "string"
  ) {
    return err(
      "INVALID_REQUEST",
      "amount, institution, accountIdentifier and refundAddress are required strings",
      400,
    );
  }

  const amountCheck = validateUsdcAmount(amountRaw);
  if (!amountCheck.ok) {
    return err("INVALID_AMOUNT", amountCheck.message, 400);
  }

  const accountCheck = validateNgnAccountIdentifier(accountRaw);
  if (!accountCheck.ok) {
    return err("INVALID_ACCOUNT_IDENTIFIER", accountCheck.message, 400);
  }

  if (!isAddress(refundRaw)) {
    return err("INVALID_REFUND_ADDRESS", "refundAddress must be a valid EVM address", 400);
  }
  const refundAddress = getAddress(refundRaw);

  const institutionsResult = await listNgnBankInstitutions();
  if (!institutionsResult.ok) {
    if (institutionsResult.code === "MISSING_CONFIG") {
      return err("CONFIGURATION_ERROR", "Paycrest is not configured", 500);
    }
    if (institutionsResult.code === "AUTH_FAILED") {
      return err("PAYCREST_AUTH_ERROR", "Paycrest authentication failed", 502);
    }
    return err("PAYCREST_UNAVAILABLE", "Could not load institutions", 502);
  }

  const institutionCheck = validateInstitutionCode(
    institutionRaw,
    institutionsResult.data,
  );
  if (!institutionCheck.ok) {
    return err("INVALID_INSTITUTION", institutionCheck.message, 400);
  }

  // Fresh recipient verification — do not trust browser accountName
  const verifyResult = await verifyNgnAccountName({
    institution: institutionCheck.data.code,
    accountIdentifier: accountCheck.data,
  });

  if (!verifyResult.ok) {
    if (verifyResult.code === "MISSING_CONFIG") {
      return err("CONFIGURATION_ERROR", "Paycrest is not configured", 500);
    }
    if (verifyResult.code === "AUTH_FAILED") {
      return err("PAYCREST_AUTH_ERROR", "Paycrest authentication failed", 502);
    }
    if (verifyResult.code === "UPSTREAM_TIMEOUT") {
      return err("PAYCREST_TIMEOUT", "Recipient re-verification timed out", 504);
    }
    return err(
      "RECIPIENT_VERIFICATION_FAILED",
      "Could not re-verify recipient before order creation",
      400,
    );
  }

  const freshName = verifyResult.data.accountName;
  if (reviewedName && !namesMatchMaterially(reviewedName, freshName)) {
    return err(
      "RECIPIENT_CHANGED",
      "Account name changed since review. Re-verify the recipient before creating an order.",
      409,
      {
        recipient: {
          institution: institutionCheck.data.code,
          institutionName: institutionCheck.data.name,
          accountIdentifierMasked: maskAccountIdentifier(accountCheck.data),
          accountName: freshName,
        },
      },
    );
  }

  const reference = generateOrderReference();

  const createResult = await createOfframpOrder({
    amount: amountCheck.data,
    reference,
    refundAddress,
    institution: institutionCheck.data.code,
    accountIdentifier: accountCheck.data,
    accountName: freshName,
  });

  if (!createResult.ok) {
    const diagnosticId = createResult.diagnosticId;
    const diagExtra = {
      reference,
      ...(diagnosticId ? { diagnosticId } : {}),
      ...(createResult.envelopeShape
        ? { envelopeShape: createResult.envelopeShape }
        : {}),
      ...(createResult.validationDetails
        ? { validationDetails: createResult.validationDetails }
        : {}),
    };

    if (createResult.message === "ORDER_CREATION_OUTCOME_UNKNOWN") {
      return err(
        "ORDER_CREATION_OUTCOME_UNKNOWN",
        "Order creation timed out. Do not create another order immediately — the previous request may have succeeded.",
        504,
        diagExtra,
      );
    }
    if (createResult.code === "MISSING_CONFIG") {
      return err("CONFIGURATION_ERROR", "Paycrest is not configured", 500);
    }
    if (createResult.code === "AUTH_FAILED") {
      return err("PAYCREST_AUTH_ERROR", "Paycrest authentication failed", 502);
    }
    if (createResult.code === "UPSTREAM_TIMEOUT") {
      return err(
        "ORDER_CREATION_OUTCOME_UNKNOWN",
        "Order creation timed out. Do not create another order immediately.",
        504,
        diagExtra,
      );
    }
    if (createResult.httpStatus === 429 || createResult.message.includes("rate limited")) {
      return err("PAYCREST_RATE_LIMITED", "Too many order requests", 429, diagExtra);
    }
    if (createResult.code === "PAYCREST_VALIDATION_FAILED") {
      return err(
        "PAYCREST_VALIDATION_FAILED",
        createResult.message
          ? `Paycrest rejected order: ${createResult.message}`
          : "Paycrest rejected the order (validation failed)",
        createResult.httpStatus || 400,
        diagExtra,
      );
    }
    if (
      createResult.code === "PAYCREST_ORDER_REJECTED" ||
      createResult.code === "INVALID_INPUT"
    ) {
      const message =
        createResult.code === "INVALID_INPUT" && createResult.message
          ? `Paycrest rejected order: ${createResult.message}`
          : createResult.message ||
            "Paycrest rejected the request without returning a safe field-level reason";
      return err(
        "PAYCREST_ORDER_REJECTED",
        message.startsWith("Paycrest ")
          ? message
          : `Paycrest rejected order: ${message}`,
        createResult.httpStatus || 400,
        diagExtra,
      );
    }
    if (createResult.code === "UPSTREAM_UNAVAILABLE") {
      return err(
        "PAYCREST_UNAVAILABLE",
        createResult.message || "Paycrest is temporarily unavailable",
        503,
        diagExtra,
      );
    }
    if (createResult.code === "PARSE_ERROR") {
      return err(
        "UPSTREAM_ERROR",
        "Paycrest returned an unusable response",
        502,
        diagExtra,
      );
    }
    // True transport / server failures only
    return err(
      "UPSTREAM_ERROR",
      createResult.message || "Order creation failed",
      createResult.httpStatus && createResult.httpStatus >= 500
        ? 502
        : 502,
      diagExtra,
    );
  }

  const normalized = normalizeCashOutOrderResponse(createResult.data.raw, {
    amount: amountCheck.data,
    refundAddress,
    institution: institutionCheck.data.code,
    institutionName: institutionCheck.data.name,
    accountName: freshName,
    accountIdentifierMasked: maskAccountIdentifier(accountCheck.data),
    reference,
  });

  if (!normalized.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ORDER_RESPONSE_UNSAFE",
          message: normalized.message,
        },
        // Order may exist at Paycrest — surface reference only
        reference,
        orderCreated: true,
        paymentBlocked: true,
        diagnosticId: createResult.data.diagnosticId,
      },
      { status: 502, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      order: normalized.order,
    },
    { status: 200, headers: NO_STORE },
  );
}
