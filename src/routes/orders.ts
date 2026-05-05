import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";

/**
 * Read-only orders endpoint for the dashboard.
 *   GET /orders → list mirrored Salla orders (most recent first)
 */
export const orders = new Hono();
orders.use("*", demoAuth);

orders.get("/", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const rows = await db
    .select()
    .from(schema.sallaOrders)
    .where(eq(schema.sallaOrders.merchantId, merchant.id))
    .orderBy(desc(schema.sallaOrders.createdAt));
  return c.json({ orders: rows });
});
