import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { db, getPgliteInstance, usingPglite } from "./index.js";

/**
 * Apply all pending Drizzle migrations from ./drizzle.
 * Works for both real Postgres (postgres-js) and embedded PGlite.
 *
 * Idempotent — safe to call repeatedly. Throws on failure so Railway
 * healthcheck fails the deploy if migrations can't apply.
 */
export async function runMigrations(): Promise<void> {
  if (usingPglite) {
    console.log("[migrate] applying migrations via PGlite");
    await migratePglite(db as any, { migrationsFolder: "./drizzle" });
    console.log("[migrate] PGlite migrations applied");
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[migrate] DATABASE_URL missing and PGlite not active — skipping");
    return;
  }
  const client = postgres(url, { max: 1, prepare: false });
  try {
    const migrationDb = drizzlePg(client);
    await migratePg(migrationDb, { migrationsFolder: "./drizzle" });
    console.log("[migrate] Postgres migrations applied");
  } finally {
    await client.end();
  }
}
