import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

/**
 * Demo-mode auth — resolves the active merchant + user from request headers.
 *
 * Headers (set by frontend):
 *   X-Merchant-Id  → merchants.id (UUID)
 *   X-User-Id      → users.id (UUID, optional; falls back to merchant owner)
 *
 * In a production build this would be a real session JWT scoped to a Salla
 * OAuth-installed merchant. For the demo, headers are sufficient.
 *
 * After this middleware:
 *   c.get("merchant") — current Merchant row
 *   c.get("user")     — current User row (or null if no users yet)
 */

declare module "hono" {
  interface ContextVariableMap {
    merchant: typeof schema.merchants.$inferSelect;
    user: typeof schema.users.$inferSelect | null;
  }
}

export async function demoAuth(c: Context, next: Next): Promise<Response | void> {
  if (!db) {
    return c.json({ error: "db_unavailable" }, 503);
  }
  const merchantId = c.req.header("X-Merchant-Id");
  if (!merchantId) {
    return c.json({ error: "missing_merchant_header" }, 401);
  }
  const merchantRows = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId))
    .limit(1);
  if (!merchantRows[0]) {
    return c.json({ error: "merchant_not_found" }, 404);
  }
  c.set("merchant", merchantRows[0]);

  const userId = c.req.header("X-User-Id");
  let user: typeof schema.users.$inferSelect | null = null;
  if (userId) {
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    user = userRows[0] ?? null;
  }
  if (!user) {
    // Fallback: pick first owner of the merchant
    const ownerRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.merchantId, merchantRows[0].id))
      .limit(1);
    user = ownerRows[0] ?? null;
  }
  c.set("user", user);

  await next();
}

export function requireRole(role: "owner" | "agent") {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    if (role === "owner" && user.role !== "owner") {
      return c.json({ error: "forbidden", required: "owner" }, 403);
    }
    await next();
  };
}
