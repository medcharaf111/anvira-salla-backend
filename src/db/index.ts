import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "[db] DATABASE_URL not set — db client unavailable. Set it in Railway env."
  );
}

export const sql = connectionString
  ? postgres(connectionString, { max: 10 })
  : null;

export const db = sql ? drizzle(sql, { schema }) : null;

export { schema };
