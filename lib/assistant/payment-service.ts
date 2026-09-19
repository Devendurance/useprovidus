/**
 * Server-authoritative airtime payment preparation.
 *
 * One unexpired, unconsumed preview becomes exactly one pending airtime
 * transaction and exactly one Paycrest offramp order, and then the deposit
 * instructions the browser needs to send Celo USDC. Nothing else is trusted:
 * the client supplies only the preview identifier and its wallet context, while
 * amount, phone, network, rate, total, destination account, and reference are
 * all read from the consumed preview row or from server configuration.
 *
 * The ordering is load-bearing and cannot be rearranged:
 *   1. atomically consume the preview (single use, unexpired, same wallet);
 *   2. create the pre-order `agent_transactions` row that gates the order;
 *   3. load the server-only operating settlement account;
 *   4. call Paycrest exactly once, with no retry;
 *   5. durably bind the provider order before any instruction is returned.
 *
 * Failure discipline:
 *   - a consumption failure creates nothing and calls nothing;
 *   - a pre-order or settlement-configuration failure never reaches Paycrest;
 *   - a pre-order insert that fails releases the consumed preview, so a
 *     database failure cannot permanently burn a quote;
 *   - an ambiguous provider outcome is recorded as unknown and never retried;
 *   - a provider success that cannot be bound yields no deposit instructions.
 */

import "server-only";

import { isAddress } from "viem";

import {
  getPreviewRepository,
  PREVIEW_NOT_USABLE_MESSAGE,
  PREVIEW_STORE_UNAVAILABLE_MESSAGE,
  type PreviewRepository,
} from "@/lib/assistant/preview-repository";
import { decimalStringsEqual } from "@/lib/money/decimal";
import {
  generateOrderReference,
  normalizeCashOutOrderResponse,
} from "@/lib/paycrest/order";
import { maskAccountIdentifier } from "@/lib/paycrest/recipient";
import { createOfframpOrder } from "@/lib/paycrest/server";
import {
  getOperatingSettlementAccount,
  SETTLEMENT_CONFIG_MISSING_MESSAGE,
} from "@/lib/paycrest/server/operating-account";
import {
  getTransactionRepository,
  type TransactionRecord,
  type TransactionRepository,
} from "@/lib/transactions";

/** Server preview identifiers are `prev_${uuid}`; anything else is malformed. */
const PREVIEW_ID_PATTERN = /^prev_[0-9a-fA-F-]{8,}$/;

const MAX_PREVIEW_ID_LENGTH = 128;

export type AirtimePaymentErrorCode =
  | "ORDER_REQUEST_INVALID"
  | "WALLET_CONTEXT_INVALID"
  | "PREVIEW_NOT_USABLE"
  | "PREVIEW_STORE_UNAVAILABLE"
  | "SETTLEMENT_CONFIG_MISSING"
  | "TRANSACTION_CREATION_FAILED"
  | "PAYCREST_ORDER_REJECTED"
  | "ORDER_CREATION_OUTCOME_UNKNOWN"
  | "PAYCREST_BIND_FAILED";

export interface AirtimePaymentError {
  code: AirtimePaymentErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * Deposit instructions. `totalUsdcToSend` is the consumed preview's total, so
 * the client can never be asked to send an amount the quote did not price.
 */
export interface PaymentInstructions {
  transactionId: string;
  receiveAddress: string;
  totalUsdcToSend: string;
  validUntil: string;
}

export type AirtimePaymentResult =
  | { ok: true; data: PaymentInstructions }
  | { ok: false; error: AirtimePaymentError };

export interface AirtimePaymentOptions {
  /** Test/self-check seams; production omits both and uses the shared singletons. */
  previewRepository?: PreviewRepository;
  transactionRepository?: TransactionRepository;
}

export interface PrepareAirtimePaymentOrderInput {
  previewId: string;
  walletAddress: string;
  options?: AirtimePaymentOptions;
}

const TRANSACTION_CREATION_FAILED_MESSAGE =
  "The payment transaction could not be created and no Paycrest order was attempted. Request a fresh quote to try again";

const ORDER_REJECTED_MESSAGE =
  "Paycrest rejected the order request. Request a fresh quote to try again";

const OUTCOME_UNKNOWN_MESSAGE =
  "Order creation outcome is unknown; the provider may have created an order. Do not submit again";

const BIND_FAILED_MESSAGE =
  "The Paycrest order could not be bound to this transaction. Do not send payment";

function fail(
  code: AirtimePaymentErrorCode,
  message: string,
  retryable = false,
): AirtimePaymentResult {
  return { ok: false, error: { code, message, retryable } };
}

/** Mirrors the transaction repository's server identifier convention. */
function newTransactionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tx_${crypto.randomUUID()}`;
  }
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Safe, non-leaking messages for the provider failures that deserve their own
 * wording; every other definitive refusal uses `ORDER_REJECTED_MESSAGE`.
 */
const ORDER_REJECTION_MESSAGES: Partial<Record<string, string>> = {
  MISSING_CONFIG: "Paycrest is not configured",
  AUTH_FAILED: "Paycrest authentication failed",
};

/**
 * Records a post-creation failure on the transaction. Best effort by design:
 * the caller is already returning a safe error, and a failure to record it must
 * never turn into a second provider call.
 */
async function recordFailure(
  repo: TransactionRepository,
  transactionId: string,
  failureCode: string,
  failureReason: string,
): Promise<void> {
  try {
    const result = await repo.updateStatus(transactionId, {
      status: "failed",
      failureCode,
      failureReason,
    });
    if (!result.ok) {
      console.error(
        `[payment-service] could not record '${failureCode}' on ${transactionId}: ${result.code}`,
      );
    }
  } catch (error) {
    console.error("[payment-service] could not record transaction failure:", error);
  }
}

/**
 * Compensating rollback for a consumed preview whose gating transaction row was
 * never created. Best effort by design: the caller is already returning a safe
 * failure, and a release that fails (or throws) must never turn into a second
 * provider call or an unhandled rejection — a preview left burned only costs
 * the client a fresh quote, while a preview released by mistake would cost a
 * double spend. Only the exact `(preview, transaction)` binding is reopened.
 */
async function releaseConsumedPreview(
  repo: PreviewRepository,
  previewId: string,
  transactionId: string,
): Promise<void> {
  try {
    const released = await repo.releasePreview(previewId, transactionId);
    if (!released) {
      console.error(
        `[payment-service] could not release preview ${previewId} consumed for ${transactionId}`,
      );
    }
  } catch (error) {
    console.error("[payment-service] could not release preview:", error);
  }
}

/**
 * Deposit instructions are only ever derived from a durably bound transaction,
 * so an unbound or expired row can never become a payable instruction.
 */
function instructionsFromBoundTransaction(
  record: TransactionRecord,
): PaymentInstructions | null {
  if (record.status !== "pending" && record.status !== "settling") return null;
  if (!record.paycrestOrderId || !record.receiveAddress || !record.validUntil) {
    return null;
  }
  const expiry = Date.parse(record.validUntil);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;

  const total = record.metadata?.totalUsdcToSend;
  return {
    transactionId: record.id,
    receiveAddress: record.receiveAddress,
    totalUsdcToSend:
      typeof total === "string" && total.trim() !== ""
        ? total.trim()
        : record.amountUsdc,
    validUntil: record.validUntil,
  };
}

/**
 * Prepares one airtime payment: consumes the preview, creates the gating
 * transaction, creates the Paycrest order, binds it, and returns the deposit
 * instructions. A repeated call for an already consumed preview is rejected
 * before any provider call.
 */
export async function prepareAirtimePaymentOrder(
  input: PrepareAirtimePaymentOrderInput,
): Promise<AirtimePaymentResult> {
  // Step 1: request shape and wallet context.
  const previewId =
    typeof input?.previewId === "string" ? input.previewId.trim() : "";
  if (
    previewId === "" ||
    previewId.length > MAX_PREVIEW_ID_LENGTH ||
    !PREVIEW_ID_PATTERN.test(previewId)
  ) {
    return fail("ORDER_REQUEST_INVALID", "A valid previewId is required");
  }

  const rawWallet =
    typeof input?.walletAddress === "string" ? input.walletAddress.trim() : "";
  if (rawWallet === "" || !isAddress(rawWallet)) {
    return fail(
      "WALLET_CONTEXT_INVALID",
      "A valid wallet address is required to prepare this payment",
    );
  }
  const walletAddress = rawWallet.toLowerCase();
  const transactionId = newTransactionId();

  // Step 2: atomic single-use consumption — the only authorization to proceed.
  const previewRepository =
    input.options?.previewRepository ?? getPreviewRepository();
  let consumed;
  try {
    consumed = await previewRepository.consumePreview(
      previewId,
      walletAddress,
      transactionId,
    );
  } catch {
    return fail(
      "PREVIEW_STORE_UNAVAILABLE",
      PREVIEW_STORE_UNAVAILABLE_MESSAGE,
      true,
    );
  }
  if (!consumed.ok) {
    return consumed.code === "PREVIEW_STORE_UNAVAILABLE"
      ? fail("PREVIEW_STORE_UNAVAILABLE", PREVIEW_STORE_UNAVAILABLE_MESSAGE, true)
      : fail("PREVIEW_NOT_USABLE", PREVIEW_NOT_USABLE_MESSAGE);
  }
  // The consumed row is the authoritative quote snapshot for everything below.
  const preview = consumed.preview;

  // Step 3: pre-order row, gated by the server-derived idempotency key.
  // `paycrestReference` is NOT NULL, so the reference is generated first.
  const reference = generateOrderReference();
  const transactionRepository =
    input.options?.transactionRepository ?? getTransactionRepository();

  let created;
  try {
    created = await transactionRepository.create({
      id: transactionId,
      idempotencyKey: `idem_airtime_${preview.id}`,
      type: "airtime",
      walletAddress,
      amountUsdc: preview.amountUsdc,
      amountNgn: preview.amountNgn,
      paycrestReference: reference,
      metadata: {
        phone: preview.phone,
        network: preview.network,
        rate: preview.rate,
        totalUsdcToSend: preview.totalUsdc,
      },
    });
  } catch {
    // The row may or may not exist, but no Paycrest order does: release the
    // consumption so the failure cannot permanently burn the quote. A retry
    // that finds a row after all reuses it by idempotency key and never reaches
    // Paycrest without a binding.
    await releaseConsumedPreview(previewRepository, preview.id, transactionId);
    return fail("TRANSACTION_CREATION_FAILED", TRANSACTION_CREATION_FAILED_MESSAGE);
  }
  if (!created.ok) {
    // No gating row exists, so the preview must not stay spent for a payment
    // that was never prepared: reopen it for the caller's retry.
    await releaseConsumedPreview(previewRepository, preview.id, transactionId);
    return fail("TRANSACTION_CREATION_FAILED", TRANSACTION_CREATION_FAILED_MESSAGE);
  }

  const transaction = created.record;

  // A pre-existing row for this preview means a previous attempt already owns
  // it: return its instructions when they are complete, otherwise require
  // recovery. Never create a second Paycrest order.
  if (created.reused) {
    const instructions = instructionsFromBoundTransaction(transaction);
    if (instructions) return { ok: true, data: instructions };
    await recordFailure(
      transactionRepository,
      transaction.id,
      "ORDER_CREATION_OUTCOME_UNKNOWN",
      "Pre-order row already exists without a Paycrest binding",
    );
    return fail("ORDER_CREATION_OUTCOME_UNKNOWN", OUTCOME_UNKNOWN_MESSAGE);
  }

  // Step 4: server-only settlement account. Fail closed before Paycrest.
  const settlement = getOperatingSettlementAccount();
  if (!settlement.ok) {
    await recordFailure(
      transactionRepository,
      transaction.id,
      "SETTLEMENT_CONFIG_MISSING",
      SETTLEMENT_CONFIG_MISSING_MESSAGE,
    );
    return fail("SETTLEMENT_CONFIG_MISSING", SETTLEMENT_CONFIG_MISSING_MESSAGE);
  }

  // Step 5: exactly one Paycrest order, never automatically retried.
  let createResult;
  try {
    createResult = await createOfframpOrder({
      amount: preview.amountUsdc,
      reference,
      refundAddress: walletAddress,
      institution: settlement.data.institutionCode,
      accountIdentifier: settlement.data.accountNumber,
      accountName: settlement.data.accountName,
      memo: settlement.data.memo,
    });
  } catch {
    // The client never throws, so an unexpected throw is an ambiguous outcome.
    await recordFailure(
      transactionRepository,
      transaction.id,
      "ORDER_CREATION_OUTCOME_UNKNOWN",
      "Order creation threw before a provider answer was read",
    );
    return fail("ORDER_CREATION_OUTCOME_UNKNOWN", OUTCOME_UNKNOWN_MESSAGE);
  }

  if (!createResult.ok) {
    // A timeout or a network-level failure both mean the request may have
    // reached Paycrest without a readable answer: the outcome is unknown and a
    // retry could create a second financial order, so it is recorded as such.
    const unknownOutcome =
      createResult.code === "UPSTREAM_TIMEOUT" ||
      createResult.code === "UPSTREAM_UNAVAILABLE";

    if (unknownOutcome) {
      await recordFailure(
        transactionRepository,
        transaction.id,
        "ORDER_CREATION_OUTCOME_UNKNOWN",
        `Paycrest ${createResult.code}: outcome unknown`,
      );
      return fail("ORDER_CREATION_OUTCOME_UNKNOWN", OUTCOME_UNKNOWN_MESSAGE);
    }

    // A 2xx we cannot parse means the order exists upstream but is unreadable.
    if (createResult.httpStatus === 200 || createResult.httpStatus === 201) {
      await recordFailure(
        transactionRepository,
        transaction.id,
        "ORDER_RESPONSE_UNSAFE",
        createResult.message,
      );
      return fail("PAYCREST_BIND_FAILED", BIND_FAILED_MESSAGE);
    }

    await recordFailure(
      transactionRepository,
      transaction.id,
      createResult.code,
      createResult.message,
    );
    return fail(
      "PAYCREST_ORDER_REJECTED",
      ORDER_REJECTION_MESSAGES[createResult.code] ?? ORDER_REJECTED_MESSAGE,
    );
  }

  // Step 6: verify the provider order against the frozen quote before binding.
  const normalized = normalizeCashOutOrderResponse(createResult.data.raw, {
    amount: preview.amountUsdc,
    refundAddress: walletAddress,
    institution: settlement.data.institutionCode,
    // The airtime flow never displays the settlement recipient; the institution
    // code is the only truthful label available server-side.
    institutionName: settlement.data.institutionCode,
    accountName: settlement.data.accountName,
    accountIdentifierMasked: maskAccountIdentifier(settlement.data.accountNumber),
    reference,
  });

  if (!normalized.ok) {
    await recordFailure(
      transactionRepository,
      transaction.id,
      "ORDER_RESPONSE_UNSAFE",
      normalized.message,
    );
    return fail("PAYCREST_BIND_FAILED", BIND_FAILED_MESSAGE);
  }

  // The client is told to send the preview total, so an order demanding more
  // would be under-funded: refuse to hand over instructions instead.
  if (!decimalStringsEqual(normalized.order.totalUsdcToSend, preview.totalUsdc)) {
    await recordFailure(
      transactionRepository,
      transaction.id,
      "ORDER_TOTAL_MISMATCH",
      "Paycrest order total does not match the consumed preview total",
    );
    return fail("PAYCREST_BIND_FAILED", BIND_FAILED_MESSAGE);
  }

  // Step 7: durable binding. No binding, no instructions.
  const bindResult = await transactionRepository.bindPaycrestOrder({
    id: transaction.id,
    paycrestOrderId: normalized.order.id,
    paycrestReference: reference,
    receiveAddress: normalized.order.providerAccount.receiveAddress,
    validUntil: normalized.order.providerAccount.validUntil,
    paycrestStatus: normalized.order.status,
    metadata: {
      rate: normalized.order.rate ?? preview.rate,
      senderFee: normalized.order.senderFee,
      transactionFee: normalized.order.transactionFee,
      totalUsdcToSend: preview.totalUsdc,
      refundAddress: walletAddress,
    },
  });

  if (!bindResult.ok) {
    await recordFailure(
      transactionRepository,
      transaction.id,
      "PAYCREST_BIND_FAILED",
      bindResult.message,
    );
    return fail("PAYCREST_BIND_FAILED", BIND_FAILED_MESSAGE);
  }

  const instructions = instructionsFromBoundTransaction(bindResult.record);
  if (!instructions) {
    await recordFailure(
      transactionRepository,
      transaction.id,
      "PAYCREST_BIND_FAILED",
      "Bound transaction did not carry complete payment instructions",
    );
    return fail("PAYCREST_BIND_FAILED", BIND_FAILED_MESSAGE);
  }

  return { ok: true, data: instructions };
}
