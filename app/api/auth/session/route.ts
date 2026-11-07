import { NextResponse } from "next/server";
import { requireOwner, NO_STORE } from "@/lib/recipients/routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ ok: true, address: auth.owner }, { headers: NO_STORE });
}
