import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "@/lib/db/schema";

export type DbClient = PostgresJsDatabase<typeof schema>;

let pgClient: Sql | null = null;
let dbInstance: DbClient | null = null;

/**
 * Returns a typed Drizzle ORM client connected to Supabase Postgres,
 * or null if DATABASE_URL is not configured (e.g. during build / local unit tests).
 */
export function getDb(): DbClient | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!dbInstance) {
    pgClient = postgres(connectionString, {
      max: process.env.NODE_ENV === "production" ? 10 : 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // Recommended for Supabase transaction pooler (port 6543)
    });
    dbInstance = drizzle(pgClient, { schema });
  }

  return dbInstance;
}

export { schema };
