import { NextResponse } from "next/server";
import { reconcileTransaction } from "@/lib/paycrest/server/reconciliation";
import {
  getTransactionRepository,
  toPublicTransactionDto,
} from "@/lib/transactions";
import { computeTransactionStage } from "@/lib/transactions/status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

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

  const repo = getTransactionRepository();
  let tx = await repo.findById(id);

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

  const url = new URL(request.url);
  const shouldReconcile =
    url.searchParams.get("reconcile") === "true" ||
    (tx.status === "settling" && Boolean(tx.paycrestOrderId));

  const isTerminal =
    tx.status === "failed" ||
    tx.status === "refunded" ||
    tx.status === "completed" ||
    (tx.status === "settled" && tx.paycrestStatus?.toLowerCase() === "settled");

  if (shouldReconcile && tx.paycrestOrderId && !isTerminal) {
    try {
      const reconcile = await reconcileTransaction(tx.id);
      if (reconcile.ok) {
        tx = reconcile.transaction;
      }
    } catch {
      // Reconcile network failure does not block returning current known state
    }
  }

  const stageInfo = computeTransactionStage(tx);

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
    },
    { status: 200, headers: NO_STORE },
  );
}
