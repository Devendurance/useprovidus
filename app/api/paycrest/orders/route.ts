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
import { getTransactionRepository } from "@/lib/transactions";

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
    "idempotencyKey",
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

  const idempotencyKey =
    typeof rec.idempotencyKey === "string" && rec.idempotencyKey.trim() !== ""
      ? rec.idempotencyKey.trim()
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
  const repo = getTransactionRepository();

  // Idempotency: check if an order already exists for this idempotency key
  // Checked BEFORE upstream calls so retries never make unnecessary network calls
  if (idempotencyKey) {
    const existing = await repo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.paycrestOrderId && existing.receiveAddress) {
        return NextResponse.json(
          {
            ok: true,
            order: {
              id: existing.paycrestOrderId,
              status: existing.paycrestStatus || "initiated",
              amount: existing.amountUsdc,
              rate: existing.metadata?.rate ?? null,
              senderFee: existing.metadata?.senderFee ?? "0",
              transactionFee: existing.metadata?.transactionFee ?? "0",
              totalUsdcToSend:
                existing.metadata?.totalUsdcToSend ?? existing.amountUsdc,
              providerAccount: {
                network: "celo",
                receiveAddress: getAddress(existing.receiveAddress),
                validUntil: existing.validUntil ?? "",
              },
              recipient: {
                institution:
                  existing.metadata?.institution ?? institutionRaw,
                institutionName:
                  existing.metadata?.institutionName ?? "Bank",
                accountName:
                  existing.metadata?.accountName ?? reviewedName ?? "Recipient",
                accountIdentifierMasked:
                  existing.metadata?.accountIdentifierMasked ??
                  maskAccountIdentifier(accountCheck.data),
              },
              refundAddress,
              reference: existing.paycrestReference,
              createdAt: existing.createdAt,
            },
            transactionId: existing.id,
            reused: true,
          },
          { status: 200, headers: NO_STORE },
        );
      }

      if (existing.status === "failed") {
        return err(
          "PAYCREST_ORDER_REJECTED",
          existing.failureReason || "Previous order creation failed",
          400,
          {
            reference: existing.paycrestReference,
            transactionId: existing.id,
          },
        );
      }

      // Pre-order row exists but has no paycrestOrderId (timeout or unknown outcome previously).
      // CRITICAL: NEVER call createOfframpOrder again!
      return err(
        "ORDER_CREATION_OUTCOME_UNKNOWN",
        "A previous order creation request was initiated with this idempotency key and its outcome remains unknown. Do not submit again immediately.",
        504,
        {
          reference: existing.paycrestReference,
          transactionId: existing.id,
          recoveryRequired: true,
          paymentBlocked: true,
        },
      );
    }
  }

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
  const effectiveIdempotencyKey = idempotencyKey || reference;

  // Persist pre-order transaction row before calling Paycrest
  const txInit = await repo.create({
    idempotencyKey: effectiveIdempotencyKey,
    type: "cash_out",
    walletAddress: refundAddress,
    amountUsdc: amountCheck.data,
    paycrestReference: reference,
    metadata: {
      institution: institutionCheck.data.code,
      institutionName: institutionCheck.data.name,
      accountIdentifierMasked: maskAccountIdentifier(accountCheck.data),
      accountName: freshName,
      refundAddress,
    },
  });

  if (!txInit.ok) {
    if (txInit.code === "DATABASE_UNAVAILABLE") {
      return err("CONFIGURATION_ERROR", txInit.message, 500);
    }
    return err("UPSTREAM_ERROR", txInit.message, 500);
  }

  const transaction = txInit.record;
  if (txInit.reused) {
    // A concurrent request won the race or row already existed
    const existing = txInit.record;
    if (existing.paycrestOrderId && existing.receiveAddress) {
      return NextResponse.json(
        {
          ok: true,
          order: {
            id: existing.paycrestOrderId,
            status: existing.paycrestStatus || "initiated",
            amount: existing.amountUsdc,
            rate: existing.metadata?.rate ?? null,
            senderFee: existing.metadata?.senderFee ?? "0",
            transactionFee: existing.metadata?.transactionFee ?? "0",
            totalUsdcToSend:
              existing.metadata?.totalUsdcToSend ?? existing.amountUsdc,
            providerAccount: {
              network: "celo",
              receiveAddress: getAddress(existing.receiveAddress),
              validUntil: existing.validUntil ?? "",
            },
            recipient: {
              institution:
                existing.metadata?.institution ?? institutionCheck.data.code,
              institutionName:
                existing.metadata?.institutionName ?? institutionCheck.data.name,
              accountName: existing.metadata?.accountName ?? freshName,
              accountIdentifierMasked:
                existing.metadata?.accountIdentifierMasked ??
                maskAccountIdentifier(accountCheck.data),
            },
            refundAddress,
            reference: existing.paycrestReference,
            createdAt: existing.createdAt,
          },
          transactionId: existing.id,
          reused: true,
        },
        { status: 200, headers: NO_STORE },
      );
    }

    return err(
      "ORDER_CREATION_OUTCOME_UNKNOWN",
      "An order creation request was already processed for this idempotency key.",
      504,
      {
        reference: existing.paycrestReference,
        transactionId: existing.id,
        recoveryRequired: true,
        paymentBlocked: true,
      },
    );
  }


  const createResult = await createOfframpOrder({
    amount: amountCheck.data,
    reference,
    refundAddress,
    institution: institutionCheck.data.code,
    accountIdentifier: accountCheck.data,
    accountName: freshName,
  });

  if (!createResult.ok) {
    if (
      createResult.message === "ORDER_CREATION_OUTCOME_UNKNOWN" ||
      createResult.code === "UPSTREAM_TIMEOUT"
    ) {
      await repo.updateStatus(transaction.id, {
        status: "pending",
        failureCode: "ORDER_CREATION_OUTCOME_UNKNOWN",
        failureReason: "Order creation timed out; outcome unknown",
      });
    } else {
      await repo.updateStatus(transaction.id, {
        status: "failed",
        failureCode: createResult.code,
        failureReason: createResult.message,
      });
    }
  }

  // Remainder of error checks and normalization continues...
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
    await repo.updateStatus(transaction.id, {
      status: "failed",
      failureCode: "ORDER_RESPONSE_UNSAFE",
      failureReason: normalized.message,
    });

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ORDER_RESPONSE_UNSAFE",
          message: normalized.message,
        },
        reference,
        orderCreated: true,
        paymentBlocked: true,
        diagnosticId: createResult.data.diagnosticId,
      },
      { status: 502, headers: NO_STORE },
    );
  }

  // Bind successful Paycrest order to durable transaction
  const bindResult = await repo.bindPaycrestOrder({
    id: transaction.id,
    paycrestOrderId: normalized.order.id,
    paycrestReference: reference,
    receiveAddress: normalized.order.providerAccount.receiveAddress,
    validUntil: normalized.order.providerAccount.validUntil,
    paycrestStatus: normalized.order.status,
    metadata: {
      rate: normalized.order.rate,
      senderFee: normalized.order.senderFee,
      transactionFee: normalized.order.transactionFee,
      totalUsdcToSend: normalized.order.totalUsdcToSend,
    },
  });

  if (!bindResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ORDER_BINDING_FAILED",
          message:
            "Order was created upstream but could not be durably recorded. Do not send payment yet.",
        },
        reference,
        transactionId: transaction.id,
        orderCreated: true,
        paymentBlocked: true,
      },
      { status: 500, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      order: normalized.order,
      transactionId: transaction.id,
    },
    { status: 200, headers: NO_STORE },
  );
}
