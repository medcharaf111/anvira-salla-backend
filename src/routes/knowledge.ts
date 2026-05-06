import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";

/**
 * Knowledge base routes.
 *
 *   GET    /knowledge          → list entries
 *   POST   /knowledge          → create
 *   PATCH  /knowledge/:id      → update
 *   DELETE /knowledge/:id      → delete
 *
 * The Gemini smart-replies prompt can pull in the top entries to ground
 * its suggestions in merchant-specific facts.
 */
export const knowledge = new Hono();
knowledge.use("*", demoAuth);

knowledge.get("/", async (c) => {
  const merchant = c.get("merchant");
  const rows = await db
    .select()
    .from(schema.knowledgeEntries)
    .where(eq(schema.knowledgeEntries.merchantId, merchant.id))
    .orderBy(desc(schema.knowledgeEntries.createdAt));
  return c.json({ entries: rows });
});

const createSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

knowledge.post("/", zValidator("json", createSchema), async (c) => {
  const merchant = c.get("merchant");
  const data = c.req.valid("json");
  const [created] = await db
    .insert(schema.knowledgeEntries)
    .values({
      merchantId: merchant.id,
      question: data.question,
      answer: data.answer,
      tags: data.tags ?? [],
    })
    .returning();
  return c.json({ ok: true, entry: created });
});

const updateSchema = z.object({
  question: z.string().optional(),
  answer: z.string().optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

knowledge.patch("/:id", zValidator("json", updateSchema), async (c) => {
  const merchant = c.get("merchant");
  const id = c.req.param("id")!;
  const data = c.req.valid("json");
  const [updated] = await db
    .update(schema.knowledgeEntries)
    .set(data)
    .where(
      and(
        eq(schema.knowledgeEntries.id, id),
        eq(schema.knowledgeEntries.merchantId, merchant.id)
      )
    )
    .returning();
  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, entry: updated });
});

knowledge.delete("/:id", async (c) => {
  const merchant = c.get("merchant");
  const id = c.req.param("id")!;
  const [deleted] = await db
    .delete(schema.knowledgeEntries)
    .where(
      and(
        eq(schema.knowledgeEntries.id, id),
        eq(schema.knowledgeEntries.merchantId, merchant.id)
      )
    )
    .returning();
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
