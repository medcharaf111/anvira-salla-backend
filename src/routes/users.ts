import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { demoAuth, requireRole } from "../middleware/demo-auth.js";

/**
 * Users API.
 *   GET    /users                  → list users in current merchant (anyone authed)
 *   POST   /users                  → create new user (owner only)
 *   PATCH  /users/:id              → update user fields (owner only)
 *   DELETE /users/:id              → deactivate user (owner only)
 */
export const users = new Hono();

users.use("*", demoAuth);

users.get("/", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.merchantId, merchant.id));
  return c.json({ users: rows });
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  whatsappDisplayName: z.string().optional(),
  role: z.enum(["owner", "agent"]).default("agent"),
});

users.post(
  "/",
  requireRole("owner"),
  zValidator("json", createSchema),
  async (c) => {
    const merchant = c.get("merchant");
    if (!db) return c.json({ error: "db_unavailable" }, 503);
    const data = c.req.valid("json");
    const [created] = await db
      .insert(schema.users)
      .values({
        merchantId: merchant.id,
        name: data.name,
        email: data.email,
        whatsappDisplayName: data.whatsappDisplayName ?? null,
        role: data.role,
      })
      .returning();
    return c.json({ ok: true, user: created });
  }
);

const updateSchema = z.object({
  name: z.string().optional(),
  whatsappDisplayName: z.string().nullable().optional(),
  role: z.enum(["owner", "agent"]).optional(),
  active: z.boolean().optional(),
});

users.patch(
  "/:id",
  requireRole("owner"),
  zValidator("json", updateSchema),
  async (c) => {
    const merchant = c.get("merchant");
    if (!db) return c.json({ error: "db_unavailable" }, 503);
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const [updated] = await db
      .update(schema.users)
      .set(data)
      .where(
        and(eq(schema.users.id, id), eq(schema.users.merchantId, merchant.id))
      )
      .returning();
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, user: updated });
  }
);

users.delete("/:id", requireRole("owner"), async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id")!;
  const [updated] = await db
    .update(schema.users)
    .set({ active: false })
    .where(
      and(eq(schema.users.id, id), eq(schema.users.merchantId, merchant.id))
    )
    .returning();
  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
