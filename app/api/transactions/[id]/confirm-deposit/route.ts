import { NextResponse } from "next/server";
import { getAddress, isAddress, type Hash } from "viem";
import { verifyCeloUsdcDepositReceipt } from "@/lib/celo/verify-deposit";
import { usdcToBaseUnits } from "@/lib/money/decimal";
import {
  getTransactionRepository,
  toPublicTransactionDto,
} from "@/lib/transactions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(
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

  let body: unknown;
  try {
    const raw = await request.text();
    body = raw === "" ? null : JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object" },
      { status: 400, headers: NO_STORE },
    );
  }

  const rec = body as Record<string, unknown>;
  const celoTxHash = rec.celoTxHash;
  if (typeof celoTxHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(celoTxHash)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "celoTxHash must be a valid 66-character hex string starting with 0x",
      },
      { status: 400, headers: NO_STORE },
    );
  }
  const hash = celoTxHash as Hash;
  const repo = getTransactionRepository();
  const tx = await repo.findById(id);

  if (!tx) {
    return NextResponse.json(
      { ok: false, code: "TRANSACTION_NOT_FOUND", error: `Transaction ${id} not found` },
      { status: 404, headers: NO_STORE },
    );
  }

  if (!tx.receiveAddress || !isAddress(tx.receiveAddress)) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_RECEIVE_ADDRESS",
        error: "Transaction is missing a valid Paycrest receive address",
      },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!tx.walletAddress || !isAddress(tx.walletAddress)) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_WALLET_ADDRESS",
        error: "Transaction is missing a valid user wallet address",
      },
      { status: 400, headers: NO_STORE },
    );
  }

  // Compute required USDC base units
  const requiredAmountString =
    tx.metadata?.totalUsdcToSend || tx.amountUsdc;
  let expectedAmountBaseUnits: bigint;
  try {
    expectedAmountBaseUnits = usdcToBaseUnits(requiredAmountString, 6);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_AMOUNT",
        error: "Could not compute base units for transaction amount",
      },
      { status: 400, headers: NO_STORE },
    );
  }

  // Authoritative server-side verification of Celo receipt
  const verification = await verifyCeloUsdcDepositReceipt({
    txHash: hash,
    expectedSender: getAddress(tx.walletAddress),
    expectedRecipient: getAddress(tx.receiveAddress),
    expectedAmountBaseUnits,
  });

  if (!verification.valid) {
    return NextResponse.json(
      {
        ok: false,
        code: verification.code || "RECEIPT_VERIFICATION_FAILED",
        error: verification.reason || "Celo transaction receipt verification failed",
      },
      { status: 422, headers: NO_STORE },
    );
  }

  const bindResult = await repo.bindCeloTxHash({
    id,
    celoTxHash: hash,
  });

  if (!bindResult.ok) {
    const status =
      bindResult.code === "TRANSACTION_NOT_FOUND"
        ? 404
        : bindResult.code === "ILLEGAL_TRANSITION"
          ? 409
          : 400;

    return NextResponse.json(
      { ok: false, code: bindResult.code, error: bindResult.message },
      { status, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      transaction: toPublicTransactionDto(bindResult.record),
    },
    { status: 200, headers: NO_STORE },
  );
}
