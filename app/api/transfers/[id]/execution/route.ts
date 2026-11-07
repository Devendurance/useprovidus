import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getStore, requireOwnerForMutation, readBody, isPlainObject, errorResponse, NO_STORE } from "@/lib/recipients/routes";
import { createDrizzleIntentStore } from "@/lib/transfers/repository";
import { createDrizzleSubmissionStore } from "@/lib/transfers/submissions";
import { prepareWebExecution } from "@/lib/transfers/web-execution";
import { ExecutionError } from "@/lib/transfers/execution";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value) || Object.keys(body.value).length !== 0) return errorResponse("INVALID_REQUEST", "Only an empty object is accepted. Payment terms come from the stored intent.", 400);
  const db = getDb();
  const recipients = getStore();
  if (!db || !recipients) return errorResponse("STORAGE_UNAVAILABLE", "Transfer storage is not configured.", 503);
  try {
    const { id } = await context.params;
    const result = await prepareWebExecution(createDrizzleIntentStore(db), recipients, createDrizzleSubmissionStore(db), auth.owner, id, process.env.PROVIDUS_PAY_CONTRACT_968);
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ExecutionError) return errorResponse(error.code, error.message, error.code === "NOT_FOUND" ? 404 : 409);
    return errorResponse("EXECUTION_UNAVAILABLE", "Cannot prepare payment. Recheck your session and try again.", 503);
  }
}
