import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";
import { logActivity } from "../services/activity.js";

/**
 * Personal API keys per user.
 *
 *   GET    /api-keys            → list my keys (current user only)
 *   POST   /api-keys            → generate (returns plaintext ONCE)
 *   DELETE /api-keys/:id        → revoke
 *
 * The plaintext key is shown only at creation. Subsequent reads see the
 * 4-char preview ("...x9z2") + the SHA-256 hash for verification.
 */
export const apiKeys = new Hono();
apiKeys.use("*", demoAuth);

apiKeys.get("/", async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!user) return c.json({ error: "no_user" }, 401);
  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.merchantId, merchant.id),
        eq(schema.apiKeys.userId, user.id),
        isNull(schema.apiKeys.revokedAt)
      )
    )
    .orderBy(desc(schema.apiKeys.createdAt));
  return c.json({ keys: rows });
});

const createSchema = z.object({ name: z.string().min(1).max(80) });

apiKeys.post("/", zValidator("json", createSchema), async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!user) return c.json({ error: "no_user" }, 401);
  const { name } = c.req.valid("json");

  const raw = `anv_${randomBytes(24).toString("base64url")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  const preview = raw.slice(-4);

  const [created] = await db
    .insert(schema.apiKeys)
    .values({
      merchantId: merchant.id,
      userId: user.id,
      name,
      keyHash: hash,
      keyPreview: preview,
    })
    .returning();

  await logActivity({
    merchantId: merchant.id,
    actorUserId: user.id,
    action: "api_key.created",
    targetKind: "api_key",
    targetId: created.id,
    metadata: { name },
  });

  // Return raw key ONCE — caller must store it.
  return c.json({ ok: true, key: created, plaintext: raw });
});

apiKeys.delete("/:id", async (c) => {
  const merchant = c.get("merchant");
  const user = c.get("user");
  if (!user) return c.json({ error: "no_user" }, 401);
  const id = c.req.param("id")!;
  const [revoked] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiKeys.id, id),
        eq(schema.apiKeys.merchantId, merchant.id),
        eq(schema.apiKeys.userId, user.id)
      )
    )
    .returning();
  if (!revoked) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
