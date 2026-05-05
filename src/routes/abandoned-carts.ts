import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";
import { draftCartRecoveryMessage } from "../ai/gemini.js";
import { sendWhatsApp } from "../whatsapp/client.js";

/**
 * Abandoned cart recovery API.
 *
 *   GET  /abandoned-carts                    → list carts (most recent first)
 *   POST /abandoned-carts/:id/recover        → draft + send recovery WhatsApp
 *
 * Demo flow:
 *   1. Frontend lists abandoned carts.
 *   2. Owner/agent clicks "Send recovery" on a cart.
 *   3. Backend generates a Gemini Khaleeji message referencing the cart contents.
 *   4. Backend sends via WhatsApp client (mock-mode logs, real-mode hits Meta).
 *   5. Backend writes a message + new conversation if no thread exists yet.
 *   6. Backend marks cart.recoveryMessageSentAt.
 */
export const abandonedCarts = new Hono();

abandonedCarts.use("*", demoAuth);

abandonedCarts.get("/", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const rows = await db
    .select()
    .from(schema.abandonedCarts)
    .where(eq(schema.abandonedCarts.merchantId, merchant.id))
    .orderBy(desc(schema.abandonedCarts.createdAt));

  return c.json({ carts: rows });
});

abandonedCarts.post("/:id/recover", async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const id = c.req.param("id");
  const cartRows = await db
    .select()
    .from(schema.abandonedCarts)
    .where(
      and(
        eq(schema.abandonedCarts.id, id),
        eq(schema.abandonedCarts.merchantId, merchant.id)
      )
    )
    .limit(1);
  const cart = cartRows[0];
  if (!cart) return c.json({ error: "not_found" }, 404);
  if (!cart.customerPhone) {
    return c.json({ error: "no_customer_phone" }, 400);
  }

  const productNames = Array.isArray((cart.rawPayload as any)?.products)
    ? ((cart.rawPayload as any).products as string[])
    : [];

  const draft = await draftCartRecoveryMessage({
    merchantName: merchant.name,
    customerName: null,
    cartTotalSar: Math.round((cart.totalAmount ?? 0) / 100),
    productNames,
  });

  const send = await sendWhatsApp({
    to: cart.customerPhone,
    body: draft,
    agentDisplayName: user?.whatsappDisplayName ?? user?.name,
  });

  // Find or create a conversation for this customer.
  const existingConv = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.merchantId, merchant.id),
        eq(schema.conversations.customerPhone, cart.customerPhone)
      )
    )
    .limit(1);

  let conversationId: string;
  if (existingConv[0]) {
    conversationId = existingConv[0].id;
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), status: "open" })
      .where(eq(schema.conversations.id, conversationId));
  } else {
    const [created] = await db
      .insert(schema.conversations)
      .values({
        merchantId: merchant.id,
        customerPhone: cart.customerPhone,
        customerName: null,
        status: "open",
        lastMessageAt: new Date(),
      })
      .returning();
    conversationId = created.id;
  }

  await db.insert(schema.messages).values({
    conversationId,
    direction: "out",
    body: draft,
    whatsappMessageId: send.messageId || null,
    sentByUserId: user?.id ?? null,
    aiGenerated: true,
  });

  await db
    .update(schema.abandonedCarts)
    .set({ recoveryMessageSentAt: new Date() })
    .where(eq(schema.abandonedCarts.id, id));

  return c.json({ ok: true, draft, whatsapp: send, conversationId });
});

abandonedCarts.get("/pending", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const rows = await db
    .select()
    .from(schema.abandonedCarts)
    .where(
      and(
        eq(schema.abandonedCarts.merchantId, merchant.id),
        isNull(schema.abandonedCarts.recoveryMessageSentAt)
      )
    )
    .orderBy(desc(schema.abandonedCarts.createdAt));

  return c.json({ carts: rows });
});
