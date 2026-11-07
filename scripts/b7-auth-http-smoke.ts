import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

async function main() {
  if (process.env.B7_LOCAL_AUTH_SMOKE !== "1") throw new Error("Run only against the isolated local B7 server with DATABASE_URL disabled.");
  const origin = "http://localhost:3000";
  await fetch(`${origin}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ message: "invalid", signature: "0x" }) });
  const account = privateKeyToAccount(generatePrivateKey());
  const challenge = await fetch(`${origin}/api/auth/challenge`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ address: account.address, chainId: 968 }) });
  assert.equal(challenge.status, 200);
  const { message } = await challenge.json();
  const signature = await account.signMessage({ message });
  const response = await fetch(`${origin}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ message, signature }) });
  assert.equal(response.status, 200, "Actual local SIWE HTTP verification must succeed");
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const session = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).address, account.address);
  console.log("Actual isolated Next SIWE HTTP challenge, signature verification and session-cookie recovery passed.");
}
void main();
