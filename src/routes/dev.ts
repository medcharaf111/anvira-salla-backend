import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { ensureDemoSeed } from "../seed/demo-seed.js";

/**
 * Developer / demo-only routes.
 *
 * NOT for production — these expose helpers for the demo MVP:
 *   POST /dev/seed                       → ensure demo merchant + sample data
 *   GET  /dev/me                         → return demo merchant id + users (for frontend bootstrap)
 *   POST /dev/whatsapp/simulate-inbound  → simulate an inbound WhatsApp message
 */
export const dev = new Hono();

dev.post("/seed", async (c) => {
  const result = await ensureDemoSeed();
  if (!result) return c.json({ error: "db_unavailable" }, 503);
  return c.json({ ok: true, ...result });
});

dev.get("/me", async (c) => {
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const merchants = await db.select().from(schema.merchants).limit(1);
  if (!merchants[0]) {
    const result = await ensureDemoSeed();
    return c.json(result);
  }
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.merchantId, merchants[0].id));
  return c.json({
    merchantId: merchants[0].id,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      whatsappDisplayName: u.whatsappDisplayName,
    })),
  });
});

const inboundSchema = z.object({
  conversationId: z.string().uuid().optional(),
  customerPhone: z.string().min(5).optional(),
  customerName: z.string().optional(),
  body: z.string().min(1),
});

dev.post("/whatsapp/simulate-inbound", zValidator("json", inboundSchema), async (c) => {
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const { conversationId, customerPhone, customerName, body } = c.req.valid("json");

  const merchantHeader = c.req.header("X-Merchant-Id");
  if (!merchantHeader) return c.json({ error: "missing_merchant_header" }, 401);

  let convId = conversationId;
  if (!convId) {
    if (!customerPhone) return c.json({ error: "need_conversation_or_phone" }, 400);
    const [conv] = await db
      .insert(schema.conversations)
      .values({
        merchantId: merchantHeader,
        customerPhone,
        customerName: customerName ?? null,
        status: "open",
        lastMessageAt: new Date(),
      })
      .returning();
    convId = conv.id;
  } else {
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), status: "open" })
      .where(eq(schema.conversations.id, convId));
  }

  const [msg] = await db
    .insert(schema.messages)
    .values({
      conversationId: convId,
      direction: "in",
      body,
    })
    .returning();

  return c.json({ ok: true, conversationId: convId, message: msg });
});
