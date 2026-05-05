import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * Database client.
 *
 * Strategy:
 *   - If DATABASE_URL is set → real Postgres (Railway, Neon, etc.) via postgres-js
 *   - Otherwise → embedded PGlite (file-backed at ./.pglite-data), zero-setup demo
 *
 * Same schema, same migrations work for both because PGlite IS Postgres
 * (compiled to WASM). This keeps the demo runnable on any machine while
 * staying production-aligned.
 */

const url = process.env.DATABASE_URL;
const PGLITE_DATA_DIR = process.env.PGLITE_DATA_DIR ?? "./.pglite-data";

let pglite: PGlite | null = null;

export const usingPglite = !url;

export const db = (() => {
  if (url) {
    console.log("[db] connecting to Postgres via DATABASE_URL");
    // prepare: false → required for Supabase Transaction pooler (port 6543) and
    // any pgBouncer-style pooler that doesn't preserve prepared statements
    // across sessions. Harmless on direct/session-pooler connections.
    const client = postgres(url, { max: 10, prepare: false });
    return drizzlePg(client, { schema });
  }
  console.log(`[db] using embedded PGlite at ${PGLITE_DATA_DIR}`);
  pglite = new PGlite(PGLITE_DATA_DIR);
  return drizzlePglite(pglite, { schema });
})();

export function getPgliteInstance(): PGlite | null {
  return pglite;
}

export { schema };
