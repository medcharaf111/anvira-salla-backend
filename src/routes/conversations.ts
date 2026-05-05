import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";
import { suggestReplies } from "../ai/gemini.js";
import { sendWhatsApp } from "../whatsapp/client.js";

/**
 * Conversations API.
 *
 * All routes require demoAuth (X-Merchant-Id + optional X-User-Id).
 *
 *   GET  /conversations                          → list conversations for current merchant
 *   GET  /conversations/:id                      → conversation + messages
 *   POST /conversations/:id/messages             → send a reply (current user is sender)
 *   POST /conversations/:id/assign               → assign a user to this conversation
 *   GET  /conversations/:id/suggest-replies      → 3 Gemini-powered Khaleeji reply drafts
 */
export const conversations = new Hono();

conversations.use("*", demoAuth);

conversations.get("/", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const rows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.merchantId, merchant.id))
    .orderBy(desc(schema.conversations.lastMessageAt));

  return c.json({ conversations: rows });
});

conversations.get("/:id", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id");

  const conv = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.id, id),
        eq(schema.conversations.merchantId, merchant.id)
      )
    )
    .limit(1);

  if (!conv[0]) return c.json({ error: "not_found" }, 404);

  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(schema.messages.createdAt);

  return c.json({ conversation: conv[0], messages });
});

const sendSchema = z.object({
  body: z.string().min(1),
  aiGenerated: z.boolean().optional(),
});

conversations.post(
  "/:id/messages",
  zValidator("json", sendSchema),
  async (c) => {
    const merchant = c.get("merchant");
    const user = c.get("user");
    if (!db) return c.json({ error: "db_unavailable" }, 503);
    if (!user) return c.json({ error: "no_user" }, 401);

    const id = c.req.param("id");
    const { body, aiGenerated } = c.req.valid("json");

    const convRows = await db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.merchantId, merchant.id)
        )
      )
      .limit(1);
    const conv = convRows[0];
    if (!conv) return c.json({ error: "not_found" }, 404);

    const send = await sendWhatsApp({
      to: conv.customerPhone,
      body,
      agentDisplayName: user.whatsappDisplayName ?? user.name,
    });

    const [msg] = await db
      .insert(schema.messages)
      .values({
        conversationId: id,
        direction: "out",
        body,
        whatsappMessageId: send.messageId || null,
        sentByUserId: user.id,
        aiGenerated: aiGenerated ?? false,
      })
      .returning();

    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), status: "open" })
      .where(eq(schema.conversations.id, id));

    return c.json({ ok: true, message: msg, whatsapp: send });
  }
);

const assignSchema = z.object({
  userId: z.string().uuid().nullable(),
});

conversations.post(
  "/:id/assign",
  zValidator("json", assignSchema),
  async (c) => {
    const merchant = c.get("merchant");
    if (!db) return c.json({ error: "db_unavailable" }, 503);
    const id = c.req.param("id");
    const { userId } = c.req.valid("json");

    if (userId) {
      const userRows = await db
        .select()
        .from(schema.users)
        .where(
          and(
            eq(schema.users.id, userId),
            eq(schema.users.merchantId, merchant.id)
          )
        )
        .limit(1);
      if (!userRows[0]) {
        return c.json({ error: "user_not_in_merchant" }, 400);
      }
    }

    const [updated] = await db
      .update(schema.conversations)
      .set({ assignedUserId: userId })
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.merchantId, merchant.id)
        )
      )
      .returning();

    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, conversation: updated });
  }
);

conversations.get("/:id/suggest-replies", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id");

  const convRows = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.id, id),
        eq(schema.conversations.merchantId, merchant.id)
      )
    )
    .limit(1);
  if (!convRows[0]) return c.json({ error: "not_found" }, 404);

  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(schema.messages.createdAt);

  const result = await suggestReplies({
    merchantName: merchant.name,
    customerName: convRows[0].customerName,
    history: messages.map((m) => ({
      direction: m.direction === "in" ? "in" : "out",
      body: m.body,
    })),
  });

  return c.json({ suggestions: result.suggestions, source: result.source });
});
