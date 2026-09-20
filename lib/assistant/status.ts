/**
 * Read-only transaction status reader for the conversational assistant.
 *
 * Hard boundary: this module performs ZERO database writes and ZERO external
 * HTTP calls. It only reads the durable transaction record through the shared
 * repository and derives the stage with the same pure rules the status API
 * uses, so the assistant can never invent or advance payment state.
 */

import "server-only";

import type { ConversationMessage } from "@/lib/assistant/types";
import {
  getTransactionRepository,
  toPublicTransactionDto,
  type PublicTransactionDto,
} from "@/lib/transactions";
import {
  computeTransactionStage,
  type StageInfo,
} from "@/lib/transactions/status";

export interface TransactionStatusSnapshot {
  transaction: PublicTransactionDto;
  stage: StageInfo;
}

export type StatusLookupErrorCode =
  | "INVALID_REFERENCE"
  | "NOT_FOUND"
  | "STATUS_UNAVAILABLE";

export type StatusLookupResult =
  | { ok: true; data: TransactionStatusSnapshot }
  | { ok: false; code: StatusLookupErrorCode; message: string };

/** Maximum accepted reference length; anything longer is not a real reference. */
const MAX_REFERENCE_LENGTH = 200;

const TX_ID_PATTERN = /\btx_[A-Za-z0-9][A-Za-z0-9_-]{2,}\b/;
const PAYCREST_ORDER_ID_PATTERN =
  /\b(?:pc_ord_|ord_)[A-Za-z0-9_-]{2,}\b/;
const ORDER_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * First match of `pattern` that fits the accepted reference boundary, or null
 * when the text holds none. Candidates are maximal runs; an overlong one is
 * skipped whole rather than truncated, so a later real reference in the text
 * still wins. Skipping resumes after a word boundary, so the shortened text
 * cannot invent a boundary the original lacked.
 */
function boundedReferenceMatch(pattern: RegExp, text: string): string | null {
  let remaining = text;
  while (remaining) {
    const match = pattern.exec(remaining);
    if (!match) return null;
    if (match[0].length <= MAX_REFERENCE_LENGTH) return match[0];
    remaining = remaining.slice(match.index + match[0].length);
  }
  return null;
}

/**
 * Extracts the first Providus/Paycrest reference found in free text: a `tx_`
 * id, a Paycrest order id (`ord_`/`pc_ord_`), or a UUID. Overlong candidates
 * are skipped so a valid reference later in the text still wins.
 */
export function extractTransactionReference(text: string): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  return (
    boundedReferenceMatch(TX_ID_PATTERN, text) ??
    boundedReferenceMatch(PAYCREST_ORDER_ID_PATTERN, text) ??
    boundedReferenceMatch(ORDER_ID_PATTERN, text)
  );
}

/**
 * Phrases that ask about an existing payment. Kept narrow on purpose: a false
 * positive replaces a conversational answer with a deterministic status reply,
 * so only explicit status/receipt language is matched.
 */
const STATUS_QUERY_PATTERN =
  /\b(status|track|tracking|progress|receipt|any update|update on|where(?:'s| is|s)? (?:my|the)|what happened to|did (?:my|the)|has (?:my|the)|is (?:my|the)|how far|done yet)\b/i;

export type StatusQueryDetection =
  | { kind: "reference"; reference: string }
  | { kind: "ask_for_reference" };

/**
 * Detects a status question and resolves which reference it concerns.
 *
 * The current message wins; otherwise the most recent reference already present
 * in the conversation is used, because a follow-up like "any update?" refers to
 * the payment the user just mentioned. With no reference anywhere, the
 * assistant asks for one instead of guessing or calling the model.
 */
export function detectStatusQuery(
  message: string,
  history: readonly ConversationMessage[],
): StatusQueryDetection | null {
  if (typeof message !== "string" || !message.trim()) return null;

  const direct = extractTransactionReference(message);
  if (direct) return { kind: "reference", reference: direct };

  if (!STATUS_QUERY_PATTERN.test(message)) return null;

  if (Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const entry = history[i];
      if (!entry || typeof entry.content !== "string") continue;
      const reference = extractTransactionReference(entry.content);
      if (reference) return { kind: "reference", reference };
    }
  }

  return { kind: "ask_for_reference" };
}

/** Prompt used when a status question arrives without a reference. */
export const STATUS_REFERENCE_REQUEST =
  "Sure — send me the transaction reference (it starts with tx_) or the Paycrest order ID and I'll check the recorded state.";

/**
 * Reads the durable record by transaction id, falling back to the Paycrest
 * order id. Read-only: no reconciliation, no provider call, no write.
 */
export async function readTransactionStatus(
  idOrOrderId: string,
): Promise<StatusLookupResult> {
  const reference = typeof idOrOrderId === "string" ? idOrOrderId.trim() : "";
  if (!reference || reference.length > MAX_REFERENCE_LENGTH) {
    return {
      ok: false,
      code: "INVALID_REFERENCE",
      message: "A valid transaction reference is required.",
    };
  }

  try {
    const repo = getTransactionRepository();
    const tx =
      (await repo.findById(reference)) ??
      (await repo.findByPaycrestOrderId(reference));

    if (!tx) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `I could not find a transaction for reference ${reference}.`,
      };
    }

    return {
      ok: true,
      data: {
        transaction: toPublicTransactionDto(tx),
        stage: computeTransactionStage(tx),
      },
    };
  } catch {
    return {
      ok: false,
      code: "STATUS_UNAVAILABLE",
      message: "Transaction status is temporarily unavailable.",
    };
  }
}

/**
 * Truthful one-message status summary. Finality is only ever claimed when the
 * derived stage says fiat was actually delivered; deposit confirmation is never
 * presented as NGN delivery.
 */
export function formatStatusAnswer(
  snapshot: TransactionStatusSnapshot,
): string {
  const { transaction, stage } = snapshot;
  const lines: string[] = [`${stage.label} — ${stage.description}`];

  const amountNgn = transaction.amountNgn
    ? `NGN ${transaction.amountNgn}`
    : null;
  const details: string[] = [`Reference: ${transaction.id}`];
  if (amountNgn) details.push(`Amount: ${amountNgn}`);
  lines.push(details.join(" · "));

  if (transaction.type === "airtime") {
    if (stage.stage === "airtime_delivered") {
      lines.push("Airtime delivered. Delivery was confirmed by ClubKonnect.");
    } else if (stage.stage === "airtime_reconciliation_required") {
      lines.push(
        "The airtime provider status is unresolved. Providus will not submit another purchase; this request needs reconciliation.",
      );
    } else if (stage.stage === "airtime_processing") {
      lines.push(
        "The airtime request was received and is still processing. Providus will not create another purchase while this request is unresolved.",
      );
    } else if (stage.stage === "airtime_submitting") {
      lines.push(
        stage.isFiatDelivered
          ? "Your Celo payment and NGN settlement are confirmed. The airtime request is being submitted."
          : "Your Celo payment is confirmed, but NGN settlement is still processing. Providus is submitting the airtime request.",
      );
    } else if (stage.stage === "settled") {
      lines.push(
        stage.isFiatDelivered
          ? "Your Celo payment and NGN settlement are confirmed. The airtime request is being prepared."
          : "Your Celo payment is confirmed, but NGN settlement is still processing. The airtime request is being prepared.",
      );
    } else if (stage.stage === "failed") {
      if (stage.isFiatDelivered || stage.isFiatFinal) {
        const reason =
          transaction.failureReason || "Provider rejected request";
        lines.push(
          `NGN settlement was confirmed, but airtime fulfilment failed: ${reason}. Providus did not issue an automatic refund.`,
        );
      } else if (stage.label === "Refunded") {
        lines.push("The deposit was refunded on Celo; no NGN was delivered.");
      } else {
        lines.push(
          "This payment did not complete; Providus did not issue an automatic refund and no NGN delivery is outstanding.",
        );
      }
    } else if (stage.stage === "recovery_required") {
      lines.push(
        "Do not send another payment for this order — it needs manual review first.",
      );
    } else if (stage.isDepositConfirmed) {
      lines.push(
        "Your Celo deposit is confirmed, but NGN bank delivery is NOT confirmed yet.",
      );
    } else {
      lines.push(
        "No confirmed Celo deposit and no confirmed NGN delivery for this order yet.",
      );
    }
  } else {
    if (stage.isFiatDelivered) {
      lines.push(
        "The provider has confirmed fiat delivery to the recipient account.",
      );
    } else if (stage.stage === "recovery_required") {
      lines.push(
        "Do not send another payment for this order — it needs manual review first.",
      );
    } else if (stage.stage === "failed") {
      lines.push(
        stage.label === "Refunded"
          ? "The deposit was refunded on Celo; no NGN was delivered."
          : "This payment did not complete; no NGN delivery is outstanding.",
      );
    } else if (stage.isDepositConfirmed) {
      lines.push(
        "Your Celo deposit is confirmed, but NGN bank delivery is NOT confirmed yet.",
      );
    } else {
      lines.push(
        "No confirmed Celo deposit and no confirmed NGN delivery for this order yet.",
      );
    }
  }
  lines.push(
    "This is the recorded state only — I can't move money or change the status here.",
  );

  return lines.join("\n");
}
