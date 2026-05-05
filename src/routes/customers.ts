import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";
import { logActivity } from "../services/activity.js";

/**
 * CRM customer routes.
 *
 *   GET  /customers                       → unique customers (aggregated from conversations)
 *   GET  /customers/:phone                → profile: convs + orders + notes
 *   POST /customers/:phone/notes          → add a note
 *   DELETE /customers/:phone/notes/:id    → remove a note
 */
export const customers = new Hono();
customers.use("*", demoAuth);

customers.get("/", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const rows = await db
    .select({
      phone: schema.conversations.customerPhone,
      name: sql<string>`MAX(${schema.conversations.customerName})`,
      conversationCount: sql<number>`COUNT(${schema.conversations.id})::int`,
      lastSeen: sql<string>`MAX(${schema.conversations.lastMessageAt})`,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.merchantId, merchant.id))
    .groupBy(schema.conversations.customerPhone)
    .orderBy(desc(sql`MAX(${schema.conversations.lastMessageAt})`));

  return c.json({ customers: rows });
});

customers.get("/:phone", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const phone = decodeURIComponent(c.req.param("phone")!);

  const convs = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.merchantId, merchant.id),
        eq(schema.conversations.customerPhone, phone)
      )
    )
    .orderBy(desc(schema.conversations.lastMessageAt));

  const orders = await db
    .select()
    .from(schema.sallaOrders)
    .where(
      and(
        eq(schema.sallaOrders.merchantId, merchant.id),
        eq(schema.sallaOrders.customerPhone, phone)
      )
    )
    .orderBy(desc(schema.sallaOrders.createdAt));

  const notes = await db
    .select()
    .from(schema.customerNotes)
    .where(
      and(
        eq(schema.customerNotes.merchantId, merchant.id),
        eq(schema.customerNotes.customerPhone, phone)
      )
    )
    .orderBy(desc(schema.customerNotes.createdAt));

  return c.json({
    phone,
    name: convs[0]?.customerName ?? null,
    conversations: convs,
    orders,
    notes,
  });
});

const noteSchema = z.object({ body: z.string().min(1) });

customers.post(
  "/:phone/notes",
  zValidator("json", noteSchema),
  async (c) => {
    const merchant = c.get("merchant");
    const user = c.get("user");
    if (!db) return c.json({ error: "db_unavailable" }, 503);
    const phone = decodeURIComponent(c.req.param("phone")!);
    const { body } = c.req.valid("json");

    const [note] = await db
      .insert(schema.customerNotes)
      .values({
        merchantId: merchant.id,
        customerPhone: phone,
        body,
        authorUserId: user?.id ?? null,
      })
      .returning();

    await logActivity({
      merchantId: merchant.id,
      actorUserId: user?.id ?? null,
      action: "customer.note_added",
      targetKind: "customer",
      targetId: phone,
      metadata: { preview: body.slice(0, 80) },
    });

    return c.json({ ok: true, note });
  }
);

customers.delete("/:phone/notes/:id", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id")!;
  const [deleted] = await db
    .delete(schema.customerNotes)
    .where(
      and(
        eq(schema.customerNotes.id, id),
        eq(schema.customerNotes.merchantId, merchant.id)
      )
    )
    .returning();
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
