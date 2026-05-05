import { and, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";
import {
  classifySentimentBatch,
  extractTopQuestions,
  summarizeConversation,
} from "../ai/gemini.js";

/**
 * Insights / analytics routes — AI-powered.
 *
 *   GET  /insights/sentiment           → distribution + per-conversation
 *   GET  /insights/top-questions       → 5 most asked things by customers
 *   GET  /insights/agent-performance   → response counts + AI usage per agent
 *   GET  /insights/peak-hours          → message volume by hour-of-day
 *   POST /conversations/:id/summary    → 3-bullet AI summary (legacy mount, also exposed via /insights for tidiness)
 */
export const insights = new Hono();
insights.use("*", demoAuth);

insights.get("/sentiment", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const convs = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.merchantId, merchant.id))
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(20);

  const lastMsgs: { id: string; lastMessage: string }[] = [];
  for (const conv of convs) {
    const recent = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conv.id),
          eq(schema.messages.direction, "in")
        )
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);
    if (recent[0]) {
      lastMsgs.push({ id: conv.id, lastMessage: recent[0].body });
    }
  }

  const result = await classifySentimentBatch(lastMsgs);
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const v of Object.values(result.byId)) {
    counts[v]++;
  }
  return c.json({
    counts,
    perConversation: result.byId,
    source: result.source,
    sample: lastMsgs.length,
  });
});

insights.get("/top-questions", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const convs = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.merchantId, merchant.id));
  const convIds = convs.map((c) => c.id);
  if (convIds.length === 0) {
    return c.json({ questions: [], source: "fallback" });
  }

  const msgs: typeof schema.messages.$inferSelect[] = [];
  for (const id of convIds) {
    const rows = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, id),
          eq(schema.messages.direction, "in")
        )
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(5);
    msgs.push(...rows);
  }

  const result = await extractTopQuestions(msgs.map((m) => m.body));
  return c.json(result);
});

insights.get("/agent-performance", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const usersRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.merchantId, merchant.id));

  const stats: {
    userId: string;
    name: string;
    role: string;
    messagesSent: number;
    aiAssisted: number;
  }[] = [];

  for (const u of usersRows) {
    const sentRows = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.sentByUserId, u.id),
          eq(schema.messages.direction, "out")
        )
      );
    const aiCount = sentRows.filter((m) => m.aiGenerated).length;
    stats.push({
      userId: u.id,
      name: u.name,
      role: u.role,
      messagesSent: sentRows.length,
      aiAssisted: aiCount,
    });
  }

  return c.json({ agents: stats });
});

insights.get("/peak-hours", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const convs = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.merchantId, merchant.id));
  const convIds = convs.map((c) => c.id);
  const buckets = Array(24).fill(0);
  if (convIds.length === 0) return c.json({ buckets });

  for (const id of convIds) {
    const rows = await db
      .select({ createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, id),
          eq(schema.messages.direction, "in"),
          gte(schema.messages.createdAt, cutoff)
        )
      );
    for (const r of rows) {
      const h = new Date(r.createdAt).getHours();
      buckets[h]++;
    }
  }
  return c.json({ buckets });
});

insights.post("/conversations/:id/summary", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id")!;

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

  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(schema.messages.createdAt);

  const result = await summarizeConversation({
    merchantName: merchant.name,
    customerName: conv[0].customerName,
    history: msgs.map((m) => ({
      direction: m.direction === "in" ? "in" : "out",
      body: m.body,
    })),
  });

  return c.json(result);
});
