import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";

/**
 * Activity log read endpoint.
 *   GET /activity → most recent entries (last 100)
 */
export const activity = new Hono();
activity.use("*", demoAuth);

activity.get("/", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(eq(schema.activityLog.merchantId, merchant.id))
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(100);
  return c.json({ entries: rows });
});
