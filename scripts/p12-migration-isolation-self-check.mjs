import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const baselinePath = path.join(process.cwd(), ".fast-build", "p1.2", "migration-baseline.json");

function requireLocalUrl() {
  const value = process.env.P12_LOCAL_DATABASE_URL;
  assert.ok(value, "Set P12_LOCAL_DATABASE_URL to the disposable local database.");
  const url = new URL(value);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.pathname, "/providus_p11");
  return value;
}

function latestJournalTag() {
  const journal = JSON.parse(
    readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
  );
  return journal.entries.at(-1)?.tag ?? null;
}

async function getMigrationCount(sql) {
  const [row] = await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
  return row.count;
}

async function tableSnapshots(sql) {
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const snapshots = {};
  for (const { table_name: tableName } of tables) {
    const quotedName = `"${tableName.replaceAll('"', '""')}"`;
    const rows = await sql.unsafe(
      `SELECT to_jsonb(row_data)::text AS row_json FROM public.${quotedName} AS row_data ORDER BY to_jsonb(row_data)::text`,
    );
    const hash = createHash("sha256");
    for (const row of rows) hash.update(row.row_json).update("\n");
    snapshots[tableName] = { count: rows.length, sha256: hash.digest("hex") };
  }
  return snapshots;
}

async function run() {
  const mode = process.argv[2];
  assert.ok(mode === "prepare" || mode === "verify", "Use prepare or verify.");
  const sql = postgres(requireLocalUrl(), { max: 1, prepare: false });
  try {
    const migrationCount = await getMigrationCount(sql);
    const tables = await tableSnapshots(sql);
    if (mode === "prepare") {
      assert.equal(migrationCount, 8, "Prepare requires migrations 0000 through 0007 already applied.");
      const journal = JSON.parse(
        readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
      );
      assert.equal(journal.entries.at(-2)?.tag, "0007_conversation_sessions");
      assert.equal(latestJournalTag(), "0008_shared_memories");
      assert.ok(!("assistant_memories" in tables), "Prepare requires the P1.2 table to be absent.");
      writeFileSync(
        baselinePath,
        `${JSON.stringify({ migrationCount, tables }, null, 2)}\n`,
        "utf8",
      );
      console.log(`Saved local migration baseline for ${Object.keys(tables).length} public tables.`);
      return;
    }

    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    assert.equal(migrationCount, 9, "Verify requires migration 0008 applied after 0007.");
    assert.equal(latestJournalTag(), "0008_shared_memories");
    assert.ok("assistant_memories" in tables, "Migration 0008 must create assistant_memories.");
    assert.equal(tables.assistant_memories.count, 0, "Verify runs before memory fixtures are inserted.");
    const oldTables = Object.fromEntries(
      Object.entries(tables).filter(([tableName]) => tableName !== "assistant_memories"),
    );
    assert.deepEqual(oldTables, baseline.tables, "Existing public table snapshots changed across migration.");
    console.log(`Verified ${Object.keys(oldTables).length} existing public tables are unchanged after migration 0008.`);
  } finally {
    await sql.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration isolation check failed.");
  process.exitCode = 1;
});
