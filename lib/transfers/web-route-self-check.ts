import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSession } from "@/lib/auth/wallet-auth";
import { POST } from "@/app/api/transfers/[id]/execution/route";
import { GET } from "@/app/api/auth/session/route";

process.env.DATABASE_URL = "";
process.env.APP_ORIGINS = "http://localhost:3000";
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const owner = "0x1111111111111111111111111111111111111111";
const config = { sessionSecret: process.env.SESSION_SECRET, origins: ["http://localhost:3000"] };
const session = createSession(config, { ownerAddress: owner, chainId: 968 });
const cookie = `providus_session=${session.token}`;
const context = { params: Promise.resolve({ id: "forged-intent" }) };
const request = (body: unknown, value = cookie, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/transfers/forged-intent/execution", { method: "POST", headers: { cookie: value, origin, "content-type": "application/json" }, body: JSON.stringify(body) });

async function main() {
  assert.equal((await POST(request({}, ""), context)).status, 401);
  assert.equal((await POST(request({}, cookie, "https://attacker.example"), context)).status, 403);
  const mismatch = request({});
  mismatch.headers.set("x-providus-wallet", "0x2222222222222222222222222222222222222222");
  assert.equal((await POST(mismatch, context)).status, 401);
  for (const body of [{ recipient: owner }, { amount: "100" }, { token: owner }, { data: "0x1234" }, { ownerAddress: owner }, { to: owner }, { value: "1" }, { reviewConfirmed: true }]) {
    const response = await POST(request(body), context);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  }
  assert.equal((await POST(request({}), context)).status, 503);
  const expired = createSession(config, { ownerAddress: owner, chainId: 968, nowMs: 0 });
  assert.equal((await POST(request({}, `providus_session=${expired.token}`), context)).status, 401);
  const ownSession = await GET(new Request("http://localhost:3000/api/auth/session", { headers: { cookie } }));
  assert.equal((await ownSession.json()).address, owner);
  console.log("B7 HTTP auth, CSRF, expired session and payment-term override checks passed. No database connection.");
}
void main();
