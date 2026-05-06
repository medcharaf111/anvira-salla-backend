import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";

/**
 * Activity log read endpoint with filters.
 *   GET /activity                        → list (filterable, last 200)
 *   GET /activity?actor=...&action=...&from=...&to=...  → filtered
 *   GET /activity/export?format=csv      → CSV download of filtered set
 */
export const activity = new Hono();
activity.use("*", demoAuth);

function buildWhere(merchantId: string, q: URLSearchParams): SQL[] {
  const where: SQL[] = [eq(schema.activityLog.merchantId, merchantId)];
  const actor = q.get("actor");
  if (actor) where.push(eq(schema.activityLog.actorUserId, actor));
  const action = q.get("action");
  if (action) where.push(eq(schema.activityLog.action, action));
  const from = q.get("from");
  if (from) {
    const d = new Date(from);
    if (!isNaN(d.getTime())) where.push(gte(schema.activityLog.createdAt, d));
  }
  const to = q.get("to");
  if (to) {
    const d = new Date(to);
    if (!isNaN(d.getTime())) where.push(lte(schema.activityLog.createdAt, d));
  }
  return where;
}

activity.get("/", async (c) => {
  const merchant = c.get("merchant");
  const url = new URL(c.req.url);
  const where = buildWhere(merchant.id, url.searchParams);
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(and(...where))
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(200);

  // Distinct actions for filter dropdown UI
  const actionsRows = await db
    .selectDistinct({ action: schema.activityLog.action })
    .from(schema.activityLog)
    .where(eq(schema.activityLog.merchantId, merchant.id));

  return c.json({
    entries: rows,
    distinctActions: actionsRows.map((r) => r.action).sort(),
  });
});

activity.get("/export", async (c) => {
  const merchant = c.get("merchant");
  const url = new URL(c.req.url);
  const where = buildWhere(merchant.id, url.searchParams);
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(and(...where))
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(5000);

  const usersRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.merchantId, merchant.id));
  const userById = new Map(usersRows.map((u) => [u.id, u.name]));

  const headers = ["created_at", "actor", "action", "target_kind", "target_id", "metadata"];
  const csvLines = [headers.join(",")];
  for (const r of rows) {
    const fields = [
      new Date(r.createdAt).toISOString(),
      r.actorUserId ? userById.get(r.actorUserId) ?? r.actorUserId : "",
      r.action,
      r.targetKind ?? "",
      r.targetId ?? "",
      r.metadata ? JSON.stringify(r.metadata).replace(/"/g, '""') : "",
    ].map((f) => `"${String(f).replace(/"/g, '""')}"`);
    csvLines.push(fields.join(","));
  }
  const csv = "﻿" + csvLines.join("\n");

  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="anvira-activity-${Date.now()}.csv"`,
  });
});
