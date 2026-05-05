import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Run all pending Drizzle migrations from ./drizzle.
 * Called from src/index.ts on boot. Idempotent — safe to call repeatedly.
 *
 * Errors are thrown so Railway healthcheck fails the deploy if migrations
 * can't apply. Better than silently running on a stale schema.
 */
export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[migrate] DATABASE_URL not set — skipping migrations");
    return;
  }
  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[migrate] migrations applied successfully");
  } finally {
    await client.end();
  }
}
