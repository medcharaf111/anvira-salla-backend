import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";
import { logActivity } from "../services/activity.js";

/**
 * Custom workflows built via the visual editor.
 *
 *   GET    /custom-workflows           → list user-built workflows
 *   POST   /custom-workflows           → create
 *   GET    /custom-workflows/:id       → fetch one (with nodes + edges)
 *   PATCH  /custom-workflows/:id       → update name / nodes / edges / enabled
 *   DELETE /custom-workflows/:id       → delete
 */
export const customWorkflows = new Hono();
customWorkflows.use("*", demoAuth);

customWorkflows.get("/", async (c) => {
  const merchant = c.get("merchant");
  const rows = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.merchantId, merchant.id))
    .orderBy(desc(schema.workflows.updatedAt));
  return c.json({ workflows: rows });
});

customWorkflows.get("/:id", async (c) => {
  const merchant = c.get("merchant");
  const id = c.req.param("id")!;
  const rows = await db
    .select()
    .from(schema.workflows)
    .where(
      and(
        eq(schema.workflows.id, id),
        eq(schema.workflows.merchantId, merchant.id)
      )
    )
    .limit(1);
  if (!rows[0]) return c.json({ error: "not_found" }, 404);
  return c.json({ workflow: rows[0] });
});

const nodesSchema = z.array(z.record(z.string(), z.any()));
const edgesSchema = z.array(z.record(z.string(), z.any()));

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  nodes: nodesSchema.optional(),
  edges: edgesSchema.optional(),
});

customWorkflows.post("/", zValidator("json", createSchema), async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  const data = c.req.valid("json");
  const [created] = await db
    .insert(schema.workflows)
    .values({
      merchantId: merchant.id,
      name: data.name,
      description: data.description ?? null,
      nodes: data.nodes ?? [],
      edges: data.edges ?? [],
    })
    .returning();
  await logActivity({
    merchantId: merchant.id,
    actorUserId: user?.id ?? null,
    action: "workflow.created",
    targetKind: "workflow",
    targetId: created.id,
    metadata: { name: created.name },
  });
  return c.json({ ok: true, workflow: created });
});

const updateSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  nodes: nodesSchema.optional(),
  edges: edgesSchema.optional(),
  enabled: z.boolean().optional(),
});

customWorkflows.patch(
  "/:id",
  zValidator("json", updateSchema),
  async (c) => {
    const merchant = c.get("merchant");
    const id = c.req.param("id")!;
    const data = c.req.valid("json");
    const [updated] = await db
      .update(schema.workflows)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(schema.workflows.id, id),
          eq(schema.workflows.merchantId, merchant.id)
        )
      )
      .returning();
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, workflow: updated });
  }
);

customWorkflows.delete("/:id", async (c) => {
  const merchant = c.get("merchant");
  const id = c.req.param("id")!;
  const [deleted] = await db
    .delete(schema.workflows)
    .where(
      and(
        eq(schema.workflows.id, id),
        eq(schema.workflows.merchantId, merchant.id)
      )
    )
    .returning();
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
