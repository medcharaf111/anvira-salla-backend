import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";

/**
 * Notifications.
 *
 *   GET   /notifications              → my unread + recent (last 30)
 *   POST  /notifications/:id/read     → mark one as read
 *   POST  /notifications/read-all     → mark all mine as read
 */
export const notifications = new Hono();
notifications.use("*", demoAuth);

notifications.get("/", async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!user) return c.json({ error: "no_user" }, 401);

  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.merchantId, merchant.id),
        or(
          eq(schema.notifications.userId, user.id),
          isNull(schema.notifications.userId)
        )
      )
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(30);

  const unreadCount = rows.filter((n) => !n.readAt).length;
  return c.json({ notifications: rows, unreadCount });
});

notifications.post("/:id/read", async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!user) return c.json({ error: "no_user" }, 401);
  const id = c.req.param("id")!;
  const [updated] = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.id, id),
        eq(schema.notifications.merchantId, merchant.id)
      )
    )
    .returning();
  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

notifications.post("/read-all", async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!user) return c.json({ error: "no_user" }, 401);

  // Drizzle doesn't have a clean "where userId IS NULL OR userId = ?" update,
  // so do two updates.
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.merchantId, merchant.id),
        eq(schema.notifications.userId, user.id),
        isNull(schema.notifications.readAt)
      )
    );
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.merchantId, merchant.id),
        isNull(schema.notifications.userId),
        isNull(schema.notifications.readAt)
      )
    );
  return c.json({ ok: true });
});
