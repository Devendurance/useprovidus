import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const mode = process.argv[2];
const localUrl = process.env.P11_LOCAL_DATABASE_URL;
const baselinePath = path.resolve(".fast-build/p11-ledger-baseline.json");

if (mode !== "prepare" && mode !== "verify") {
  throw new Error("Use prepare or verify.");
}

if (!localUrl) {
  throw new Error("Set P11_LOCAL_DATABASE_URL to the disposable P1.1 database.");
}

const parsedUrl = new URL(localUrl);
if (
  parsedUrl.hostname !== "127.0.0.1" ||
  parsedUrl.port !== "55432" ||
  parsedUrl.pathname !== "/providus_p11" ||
  parsedUrl.username !== "providus_test"
) {
  throw new Error("The P1.1 harness only accepts its fixed local Postgres target.");
}

const fixtureOwners = [
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
];
const fixtureIds = {
  agent_transactions: ["p11-fixture-celo-a", "p11-fixture-celo-b"],
  saved_recipients: ["p11-fixture-recipient-a", "p11-fixture-recipient-b"],
  wallet_transfer_intents: ["p11-fixture-intent-a", "p11-fixture-intent-b"],
  transfer_submissions: ["p11-fixture-submission-a", "p11-fixture-submission-b"],
};
const tableNames = Object.keys(fixtureIds);
const ownerColumn = {
  agent_transactions: "wallet_address",
  saved_recipients: "owner_address",
  wallet_transfer_intents: "owner_address",
  transfer_submissions: "owner_address",
};
const client = postgres(localUrl, { max: 1 });

async function migrationCount() {
  const [row] = await client.unsafe(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  return row.count;
}

function latestJournalTag() {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-1)?.tag;
}

async function snapshot() {
  const tables = {};
  for (const table of tableNames) {
    const ids = fixtureIds[table];
    const rows = await client.unsafe(
      `SELECT * FROM ${table} WHERE id = ANY($1::text[]) ORDER BY id`,
      [ids],
    );
    if (rows.length !== ids.length) {
      throw new Error(`Expected ${ids.length} sentinel rows in ${table}, found ${rows.length}.`);
    }
    const column = ownerColumn[table];
    if (rows.some((row, index) => row[column] !== fixtureOwners[index])) {
      throw new Error(`The two synthetic owners are not isolated in ${table}.`);
    }
    const serialized = JSON.stringify(rows);
    tables[table] = {
      rows: rows.length,
      sha256: createHash("sha256").update(serialized).digest("hex"),
    };
  }
  return tables;
}

async function prepare() {
  if ((await migrationCount()) !== 7 || latestJournalTag() !== "0006_brief_green_goblin") {
    throw new Error("Prepare requires migrations 0000 through 0006 and no generated 0007.");
  }
  const hasConversationTable = await client.unsafe(
    "SELECT to_regclass('public.conversation_sessions') AS relation",
  );
  if (hasConversationTable[0].relation !== null) {
    throw new Error("Conversation tables already exist in the local baseline database.");
  }

  await client.begin(async (tx) => {
    for (let index = 0; index < fixtureOwners.length; index += 1) {
      const owner = fixtureOwners[index];
      const suffix = index === 0 ? "a" : "b";

      await tx.unsafe(
        `INSERT INTO agent_transactions
          (id, idempotency_key, wallet_address, amount_usdc, paycrest_reference)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [`p11-fixture-celo-${suffix}`, `p11-idem-${suffix}`, owner, "1.25", `p11-ref-${suffix}`],
      );
      await tx.unsafe(
        `INSERT INTO saved_recipients
          (id, owner_address, label, normalized_label, chain_id, address)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [`p11-fixture-recipient-${suffix}`, owner, `P1.1 ${suffix}`, `p11-${suffix}`, index === 0 ? 42220 : 677, owner],
      );
      await tx.unsafe(
        `INSERT INTO wallet_transfer_intents
          (id, owner_address, recipient_source, recipient_address, recipient_label,
           chain_id, environment, asset_symbol, asset_decimals, amount_display,
           amount_base_units, status, terms_fingerprint, idempotency_key, expires_at)
         VALUES ($1, $2, 'manual', $3, $4, $5, 'production', $6, $7, $8, $9,
           'pending', $10, $11, now() + interval '1 day')
         ON CONFLICT (id) DO NOTHING`,
        [
          `p11-fixture-intent-${suffix}`,
          owner,
          owner,
          `P1.1 ${suffix}`,
          index === 0 ? 42220 : 677,
          index === 0 ? "USDC" : "BOT",
          index === 0 ? 6 : 18,
          "1.25",
          index === 0 ? "1250000" : "1250000000000000000",
          `p11-terms-${suffix}`,
          `p11-intent-idem-${suffix}`,
        ],
      );
      await tx.unsafe(
        `INSERT INTO transfer_submissions
          (id, intent_id, owner_address, chain_id, environment, contract_address,
           terms_fingerprint, recipient_address, amount_base_units, status)
         VALUES ($1, $2, $3, $4, 'production', $5, $6, $7, $8, 'submitted')
         ON CONFLICT (id) DO NOTHING`,
        [
          `p11-fixture-submission-${suffix}`,
          `p11-fixture-intent-${suffix}`,
          owner,
          index === 0 ? 42220 : 677,
          "0x1111111111111111111111111111111111111111",
          `p11-terms-${suffix}`,
          owner,
          index === 0 ? "1250000" : "1250000000000000000",
        ],
      );
    }
  });

  const tables = await snapshot();
  const baseline = { database: "providus_p11", migrationCount: 7, tables };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`Prepared synthetic two-owner baseline at ${baselinePath}.`);
  console.log(JSON.stringify(tables, null, 2));
}

async function verify() {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  if ((await migrationCount()) !== 8 || latestJournalTag() !== "0007_conversation_sessions") {
    throw new Error("Verify requires generated and applied migration 0007_conversation_sessions.");
  }
  const conversationTable = await client.unsafe(
    "SELECT to_regclass('public.conversation_sessions') AS relation",
  );
  if (!conversationTable[0].relation) {
    throw new Error("The local conversation_sessions table was not created.");
  }

  const current = await snapshot();
  if (JSON.stringify(current) !== JSON.stringify(baseline.tables)) {
    throw new Error(`Existing ledger sentinel rows changed. Baseline: ${JSON.stringify(baseline.tables)} Current: ${JSON.stringify(current)}`);
  }
  console.log("Verified both owners' pre-existing synthetic ledger rows are unchanged after migration 0007.");
  console.log(JSON.stringify(current, null, 2));
}

try {
  if (mode === "prepare") await prepare();
  else await verify();
} finally {
  await client.end();
}
