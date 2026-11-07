import fs from "node:fs";
import { parseEnv } from "node:util";

const env = { ...(fs.existsSync(".env") ? parseEnv(fs.readFileSync(".env", "utf8")) : {}), ...process.env };
for (const key of ["DATABASE_URL", "APP_ORIGINS", "SESSION_SECRET", "PROVIDUS_PAY_CONTRACT_968", "PROVIDUS_PAY_CONTRACT_677"]) {
  console.log(`${key}: ${env[key] ? "present" : "missing"}`);
}
console.log(`Canonical testnet contract: ${env.PROVIDUS_PAY_CONTRACT_968?.toLowerCase() === "0xbc6298701490ba211733f2dc28deb7df9835b7a4"}`);
console.log(`Local development origin allowed: ${env.APP_ORIGINS?.split(",").map(value => value.trim()).includes("http://localhost:3000") ?? false}`);
console.log(`Production origin allowed: ${env.APP_ORIGINS?.split(",").map(value => value.trim()).includes("https://useprovidus.vercel.app") ?? false}`);
console.log(`Session secret minimum length: ${(env.SESSION_SECRET?.length ?? 0) >= 32}`);
