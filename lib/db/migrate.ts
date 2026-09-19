import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export interface MigrationResult {
  ok: boolean;
  skipped: boolean;
  message?: string;
}

export async function runMigrations(): Promise<MigrationResult> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.info("DATABASE_URL is not set; skipping live database migration.");
    return { ok: true, skipped: true, message: "No DATABASE_URL configured" };
  }

  const migrationClient = postgres(connectionString, { max: 1 });
  try {
    const db = drizzle(migrationClient);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.info("Database migrations applied successfully.");
    return { ok: true, skipped: false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Database migration failed:", msg);
    return { ok: false, skipped: false, message: msg };
  } finally {
    await migrationClient.end();
  }
}

// Allow direct execution via tsx lib/db/migrate.ts
if (process.argv[1]?.includes("migrate")) {
  runMigrations().then((res) => {
    if (!res.ok) {
      process.exit(1);
    }
  });
}
