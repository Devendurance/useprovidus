/**
 * POST /api/transfers/[id]/submission — register a candidate wallet-submitted
 * tx hash, or recheck a known submission (body: { txHash } | { recheck: true }).
 *
 * A browser-supplied hash is candidate proof only — never confirmation.
 * Owner-scoped, rate-limited, same-origin guarded. Production uses shared
 * Postgres state; without a database this endpoint is unavailable (503).
 * Never broadcasts. Never marks success from chat text or API input.
 */

import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { createDrizzleIntentStore } from "@/lib/transfers/repository";
import { getTransferIntent } from "@/lib/transfers/service";
import {
  createDrizzleSubmissionStore,
  reconcileSubmission,
  registerSubmissionTx,
  SubmissionError,
} from "@/lib/transfers/submissions";
import type { ChainReader } from "@/lib/transfers/verify";
import {
  errorResponse,
  getStore,
  isPlainObject,
  NO_STORE,
  readBody,
  requireOwnerForMutation,
} from "@/lib/recipients/routes";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const RPC_TIMEOUT_MS = 10_000;

function submissionErrorResponse(err: unknown) {
  if (err instanceof SubmissionError) {
    const status =
      err.code === "NOT_FOUND" ? 404
      : err.code === "CONFLICTING_SUBMISSION" ? 409
      : 400;
    return errorResponse(err.code, err.message, status);
  }
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: string }).code);
    if (code === "NOT_FOUND") return errorResponse(code, "Payment intent not found.", 404);
    return errorResponse(code, "Transfer request failed.", 400);
  }
  return errorResponse("SUBMISSION_UNAVAILABLE", "Submission request failed.", 500);
}

function verifierConfig() {
  const c968 = process.env.PROVIDUS_PAY_CONTRACT_968;
  return {
    contracts: {
      968: c968 && isAddress(c968) ? c968 : null,
      677: null,
    } as Record<number, string | null>,
    requiredConfirmations: { 968: 5, 677: 12 },
  };
}

function liveReader(rpcUrl: string): ChainReader {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS }) });
  return {
    async getChainId() { return client.getChainId(); },
    async getTransaction(hash: string) {
      const tx = await client.getTransaction({ hash: hash as `0x${string}` });
      return {
        chainId: tx.chainId ?? null,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        input: tx.input,
        blockNumber: tx.blockNumber ?? null,
        blockHash: tx.blockHash ?? null,
      };
    },
    async getTransactionReceipt(hash: string) {
      const r = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
      if (!r) return null;
      return {
        status: r.status === "success" ? "success" : "reverted",
        from: r.from,
        to: r.to,
        logs: r.logs.map((l) => ({
          address: l.address,
          topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
          data: l.data,
        })),
        blockNumber: r.blockNumber,
        blockHash: r.blockHash,
      };
    },
    async getBlockNumber() { return client.getBlockNumber(); },
    async getBlockHash(blockNumber: bigint) {
      const b = await client.getBlock({ blockNumber });
      return b.hash;
    },
    async readUsedIntent(contract: string, payer: string, intentId: string) {
      const used = (await client.readContract({
        address: contract as Address,
        abi: [
          {
            type: "function",
            name: "usedIntents",
            stateMutability: "view",
            inputs: [{ name: "", type: "address" }, { name: "", type: "bytes32" }],
            outputs: [{ type: "bool" }],
          },
        ],
        functionName: "usedIntents",
        args: [payer as Address, intentId as `0x${string}`],
      })) as boolean;
      return used;
    },
  };
}

const RPC_BY_CHAIN: Record<number, string> = {
  968: "https://rpc.bohr.life",
  677: "https://rpc.botchain.ai",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const db = getDb();
  const recipients = getStore();
  if (!db || !recipients) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Transfer storage is not configured.", 503);
  }
  const submissions = createDrizzleSubmissionStore(db);
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value)) {
    return errorResponse("INVALID_REQUEST", "Request body must be a small JSON object.", body.ok ? 400 : 413);
  }
  const { id } = await context.params;
  const { txHash, recheck } = body.value as { txHash?: unknown; recheck?: unknown };

  try {
    const { intent } = await getTransferIntent(createDrizzleIntentStore(db), { ownerAddress: auth.owner, id });

    if (recheck === true && txHash === undefined) {
      const rpcUrl = RPC_BY_CHAIN[intent.chainId];
      if (!rpcUrl) return errorResponse("UNSUPPORTED_CHAIN", "Chain is not supported.", 400);
      const result = await reconcileSubmission(submissions, liveReader(rpcUrl), verifierConfig(), { intent });
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }

    if (typeof txHash !== "string") {
      return errorResponse("INVALID_REQUEST", "Provide txHash to register or recheck:true to re-verify.", 400);
    }
    const config = verifierConfig();
    const contract = config.contracts[intent.chainId] ?? null;
    if (!contract) {
      return errorResponse("CONTRACT_NOT_CONFIGURED", "No payment contract is configured for this chain.", 400);
    }
    const registered = await registerSubmissionTx(submissions, {
      intent,
      ownerAddress: auth.owner,
      txHash,
      contractAddress: contract,
    });
    return NextResponse.json(
      { ok: true, ...registered },
      { status: registered.deduplicated ? 200 : 201, headers: NO_STORE },
    );
  } catch (err) {
    return submissionErrorResponse(err);
  }
}
