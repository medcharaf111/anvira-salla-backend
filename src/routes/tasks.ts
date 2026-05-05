import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";
import { logActivity } from "../services/activity.js";

/**
 * Tasks API. Linked optionally to conversations or Salla orders.
 *
 *   GET    /tasks                  → list tasks (filterable by status)
 *   POST   /tasks                  → create
 *   PATCH  /tasks/:id              → update (title, status, assignee, etc.)
 *   DELETE /tasks/:id              → soft via status='archived'
 */
export const tasks = new Hono();
tasks.use("*", demoAuth);

tasks.get("/", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.merchantId, merchant.id))
    .orderBy(desc(schema.tasks.createdAt));
  return c.json({ tasks: rows });
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  assignedUserId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  sallaOrderId: z.string().nullable().optional(),
});

tasks.post("/", zValidator("json", createSchema), async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const data = c.req.valid("json");
  const [created] = await db
    .insert(schema.tasks)
    .values({
      merchantId: merchant.id,
      title: data.title,
      description: data.description ?? null,
      status: data.status,
      assignedUserId: data.assignedUserId ?? null,
      createdByUserId: user?.id ?? null,
      conversationId: data.conversationId ?? null,
      sallaOrderId: data.sallaOrderId ?? null,
    })
    .returning();

  await logActivity({
    merchantId: merchant.id,
    actorUserId: user?.id ?? null,
    action: "task.created",
    targetKind: "task",
    targetId: created.id,
    metadata: { title: created.title },
  });

  return c.json({ ok: true, task: created });
});

const updateSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
});

tasks.patch("/:id", zValidator("json", updateSchema), async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id")!;
  const data = c.req.valid("json");

  const updateData: Record<string, unknown> = { ...data };
  if (data.status === "done") {
    updateData.completedAt = new Date();
  } else if (data.status === "todo" || data.status === "in_progress") {
    updateData.completedAt = null;
  }

  const [updated] = await db
    .update(schema.tasks)
    .set(updateData)
    .where(
      and(eq(schema.tasks.id, id), eq(schema.tasks.merchantId, merchant.id))
    )
    .returning();
  if (!updated) return c.json({ error: "not_found" }, 404);

  if (data.status === "done") {
    await logActivity({
      merchantId: merchant.id,
      actorUserId: user?.id ?? null,
      action: "task.completed",
      targetKind: "task",
      targetId: updated.id,
      metadata: { title: updated.title },
    });
  }

  return c.json({ ok: true, task: updated });
});

tasks.delete("/:id", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id")!;
  const [deleted] = await db
    .delete(schema.tasks)
    .where(
      and(eq(schema.tasks.id, id), eq(schema.tasks.merchantId, merchant.id))
    )
    .returning();
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
