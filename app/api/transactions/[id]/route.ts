import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { reconcileTransaction } from "@/lib/paycrest/server/reconciliation";
import { reconcileAirtimeFulfilment } from "@/lib/clubkonnect/server/reconciliation";
import {
  instructionsFromBoundTransaction,
  validatedBoundTransactionMetadata,
  type PaymentInstructions,
} from "@/lib/assistant/payment-service";
import {
  getTransactionRepository,
  toPublicTransactionDto,
  type TransactionRecord,
} from "@/lib/transactions";
import { computeTransactionStage } from "@/lib/transactions/status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Outcome of an opt-in rehydration read. `omitted` is the legacy body for a read
 * that never asked for instructions; every other kind is an explicit answer.
 */
type RehydrationOutcome =
  | { kind: "omitted" }
  | { kind: "ineligible" }
  | { kind: "expired" }
  | { kind: "instructions"; instructions: PaymentInstructions };

/**
 * Opt-in rehydration of deposit instructions for an unfunded airtime order.
 *
 * Fail-closed end to end: the caller must present a wallet that owns the row,
 * the row must still be an unexpired, provider-bound `pending` airtime order
 * with a real destination address and a complete provider fee breakdown, and no
 * deposit hash may exist yet. Everything else is refused. Only a caller who has
 * already proved ownership of a live, unfunded, bound order is told that the
 * payment window merely elapsed: the expiry code is never an oracle for callers
 * without that proof.
 */
function rehydratePaymentInstructions(
  record: TransactionRecord,
  walletAddress: string,
): RehydrationOutcome {
  if (record.type !== "airtime") return { kind: "ineligible" };
  if (record.status !== "pending") return { kind: "ineligible" };
  if (record.celoTxHash !== null) return { kind: "ineligible" };
  if (!isAddress(walletAddress) || !isAddress(record.walletAddress)) {
    return { kind: "ineligible" };
  }
  if (walletAddress.toLowerCase() !== record.walletAddress.toLowerCase()) {
    return { kind: "ineligible" };
  }
  if (
    typeof record.paycrestOrderId !== "string" ||
    record.paycrestOrderId.trim() === "" ||
    // The address the client is told to pay must be a real EVM address: a
    // malformed one is a permanently lost deposit, never a payable instruction.
    typeof record.receiveAddress !== "string" ||
    !isAddress(record.receiveAddress) ||
    typeof record.validUntil !== "string" ||
    record.validUntil.trim() === ""
  ) {
    return { kind: "ineligible" };
  }
  // A proven expiry is only ever reported for a row that is payable in every
  // other respect: metadata is validated first, so a corrupted fee or total is
  // never misdescribed as a closed payment window.
  if (!validatedBoundTransactionMetadata(record)) {
    return { kind: "ineligible" };
  }
  const expiry = Date.parse(record.validUntil);
  if (!Number.isFinite(expiry)) return { kind: "ineligible" };
  if (expiry <= Date.now()) return { kind: "expired" };

  const instructions = instructionsFromBoundTransaction(record);
  return instructions
    ? { kind: "instructions", instructions }
    : { kind: "ineligible" };
}

/**
 * Wire shape of the opt-in rehydration fields. A read that never opted in keeps
 * the legacy body exactly: no `paymentInstructions` key and no error code.
 * Everything else reports the field explicitly, and only a confirmed expiry of
 * an otherwise payable order adds the machine-readable reason.
 */
function rehydrationFields(
  outcome: RehydrationOutcome,
): Record<string, unknown> {
  if (outcome.kind === "omitted") return {};
  if (outcome.kind === "instructions") {
    return { paymentInstructions: outcome.instructions };
  }
  if (outcome.kind === "expired") {
    return {
      paymentInstructions: null,
      paymentInstructionsError: "PAYMENT_ORDER_EXPIRED",
    };
  }
  return { paymentInstructions: null };
}

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json(
      { ok: false, error: "Transaction ID is required" },
      { status: 400, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  // Rehydration is opt-in, and only ever served from the row addressed by its
  // own id: the paycrestOrderId fallback below is a lookup convenience for the
  // plain DTO, never ownership proof for payable instructions.
  const wantsInstructions =
    url.searchParams.get("paymentInstructions") === "true";
  const requestedWallet = (url.searchParams.get("walletAddress") ?? "").trim();

  const repo = getTransactionRepository();
  const byId = await repo.findById(id);
  let tx = byId;

  if (!tx) {
    // Try by paycrestOrderId as fallback lookup
    tx = await repo.findByPaycrestOrderId(id);
  }

  if (!tx) {
    return NextResponse.json(
      { ok: false, error: `Transaction ${id} not found` },
      { status: 404, headers: NO_STORE },
    );
  }

  const shouldReconcile =
    url.searchParams.get("reconcile") === "true" ||
    (tx.status === "settling" && Boolean(tx.paycrestOrderId));

  const isTerminal =
    tx.status === "failed" ||
    tx.status === "refunded" ||
    tx.status === "completed" ||
    (tx.status === "settled" && tx.paycrestStatus?.toLowerCase() === "settled");

  // An opt-in rehydration read is a pure read: it must answer from the recorded
  // state and never trigger an upstream Paycrest or ClubKonnect call, whatever
  // the row's status or an accompanying `reconcile=true` would otherwise do.
  if (!wantsInstructions && shouldReconcile && tx.paycrestOrderId && !isTerminal) {
    try {
      const reconcile = await reconcileTransaction(tx.id);
      if (reconcile.ok) {
        tx = reconcile.transaction;
      }
    } catch {
      // Reconcile network failure does not block returning current known state
    }
  }

  if (
    !wantsInstructions &&
    url.searchParams.get("reconcile") === "true" &&
    tx.type === "airtime" &&
    tx.status === "processing"
  ) {
    try {
      const reconcile = await reconcileAirtimeFulfilment(tx.id);
      if (reconcile.ok && reconcile.transaction) {
        tx = reconcile.transaction;
      }
    } catch {
      // Reconcile network failure does not block returning current known state
    }
  }

  const stageInfo = computeTransactionStage(tx);

  // Rehydration reflects the freshest resolved state, but only for a request
  // that addressed the row by its own id: the paycrestOrderId fallback above is
  // a lookup convenience, never ownership proof for payable instructions.
  const outcome: RehydrationOutcome = wantsInstructions
    ? byId !== null
      ? rehydratePaymentInstructions(tx, requestedWallet)
      : { kind: "ineligible" }
    : { kind: "omitted" };

  return NextResponse.json(
    {
      ok: true,
      transaction: toPublicTransactionDto(tx),
      stage: stageInfo.stage,
      stageLabel: stageInfo.label,
      stageDescription: stageInfo.description,
      isFiatFinal: stageInfo.isFiatFinal,
      isFiatDelivered: stageInfo.isFiatDelivered,
      isProtocolSettled: stageInfo.isProtocolSettled,
      isDepositConfirmed: stageInfo.isDepositConfirmed,
      isAirtimeDelivered: Boolean(stageInfo.isAirtimeDelivered),
      isReconciliationRequired: Boolean(stageInfo.isReconciliationRequired),
      ...rehydrationFields(outcome),
    },
    { status: 200, headers: NO_STORE },
  );
}
