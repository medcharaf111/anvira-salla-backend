import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { demoAuth, requireRole } from "../middleware/demo-auth.js";
import { logActivity } from "../services/activity.js";

/**
 * Workflow templates — toggleable automations seeded by default.
 *
 *   GET   /workflows                  → list
 *   PATCH /workflows/:id (owner only) → toggle enabled
 */
export const workflows = new Hono();
workflows.use("*", demoAuth);

workflows.get("/", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const rows = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.merchantId, merchant.id))
    .orderBy(asc(schema.workflowTemplates.createdAt));
  return c.json({ workflows: rows });
});

workflows.patch("/:id", requireRole("owner"), async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id")!;
  const body = await c.req.json().catch(() => ({}));
  const enabled = !!body.enabled;

  const [updated] = await db
    .update(schema.workflowTemplates)
    .set({ enabled })
    .where(
      and(
        eq(schema.workflowTemplates.id, id),
        eq(schema.workflowTemplates.merchantId, merchant.id)
      )
    )
    .returning();
  if (!updated) return c.json({ error: "not_found" }, 404);

  await logActivity({
    merchantId: merchant.id,
    actorUserId: user?.id ?? null,
    action: enabled ? "workflow.enabled" : "workflow.disabled",
    targetKind: "workflow",
    targetId: updated.id,
    metadata: { slug: updated.slug },
  });

  return c.json({ ok: true, workflow: updated });
});
