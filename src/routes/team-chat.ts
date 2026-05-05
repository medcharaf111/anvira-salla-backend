import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";

/**
 * Internal team chat routes (Slack-like channels + messages).
 *
 *   GET   /team/channels                   → list channels
 *   POST  /team/channels                   → create
 *   GET   /team/channels/:id/messages      → thread
 *   POST  /team/channels/:id/messages      → post message
 */
export const teamChat = new Hono();
teamChat.use("*", demoAuth);

teamChat.get("/channels", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const rows = await db
    .select()
    .from(schema.teamChannels)
    .where(eq(schema.teamChannels.merchantId, merchant.id))
    .orderBy(asc(schema.teamChannels.createdAt));
  return c.json({ channels: rows });
});

const createChannelSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().optional(),
  kind: z.enum(["channel", "dm"]).default("channel"),
});

teamChat.post(
  "/channels",
  zValidator("json", createChannelSchema),
  async (c) => {
    const merchant = c.get("merchant");
    if (!db) return c.json({ error: "db_unavailable" }, 503);
    const data = c.req.valid("json");
    const [created] = await db
      .insert(schema.teamChannels)
      .values({
        merchantId: merchant.id,
        name: data.name,
        description: data.description ?? null,
        kind: data.kind,
      })
      .returning();
    return c.json({ ok: true, channel: created });
  }
);

teamChat.get("/channels/:id/messages", async (c) => {
  const merchant = c.get("merchant");
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const id = c.req.param("id")!;

  const channelRows = await db
    .select()
    .from(schema.teamChannels)
    .where(
      and(
        eq(schema.teamChannels.id, id),
        eq(schema.teamChannels.merchantId, merchant.id)
      )
    )
    .limit(1);
  if (!channelRows[0]) return c.json({ error: "not_found" }, 404);

  const msgs = await db
    .select()
    .from(schema.teamMessages)
    .where(eq(schema.teamMessages.channelId, id))
    .orderBy(asc(schema.teamMessages.createdAt));

  return c.json({ channel: channelRows[0], messages: msgs });
});

const postMessageSchema = z.object({ body: z.string().min(1) });

teamChat.post(
  "/channels/:id/messages",
  zValidator("json", postMessageSchema),
  async (c) => {
    const merchant = c.get("merchant");
    const user = c.get("user");
    if (!db) return c.json({ error: "db_unavailable" }, 503);
    if (!user) return c.json({ error: "no_user" }, 401);
    const id = c.req.param("id")!;
    const { body } = c.req.valid("json");

    const channelRows = await db
      .select()
      .from(schema.teamChannels)
      .where(
        and(
          eq(schema.teamChannels.id, id),
          eq(schema.teamChannels.merchantId, merchant.id)
        )
      )
      .limit(1);
    if (!channelRows[0]) return c.json({ error: "not_found" }, 404);

    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(body)) !== null) {
      mentions.push(match[1]);
    }

    const [msg] = await db
      .insert(schema.teamMessages)
      .values({
        channelId: id,
        authorUserId: user.id,
        body,
        mentions: mentions.length > 0 ? mentions : null,
      })
      .returning();

    return c.json({ ok: true, message: msg });
  }
);
