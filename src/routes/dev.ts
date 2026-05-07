import { desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { ensureDemoSeed } from "../seed/demo-seed.js";

/**
 * Developer / demo-only routes.
 *
 * NOT for production — these expose helpers for the demo MVP:
 *   POST /dev/seed                       → ensure demo merchant + sample data
 *   GET  /dev/me                         → return demo merchant id + users (for frontend bootstrap)
 *   POST /dev/whatsapp/simulate-inbound  → simulate an inbound WhatsApp message
 */
export const dev = new Hono();

dev.post("/seed", async (c) => {
  const result = await ensureDemoSeed();
  if (!result) return c.json({ error: "db_unavailable" }, 503);
  return c.json({ ok: true, ...result });
});

/**
 * Bootstrap endpoint for the dashboard.
 *
 * Returns:
 *   - merchants: all merchants (active first, then uninstalled), so the
 *     frontend can render a switcher
 *   - merchantId: the recommended default — the latest *real* (Salla-installed)
 *     active merchant if any exists, else the demo merchant
 *   - users: users for the selected merchant
 *
 * Optional query: ?merchantId=<id> → return that specific merchant's users
 * (used by the frontend when a user explicitly selects a merchant in the
 *  switcher and we re-fetch).
 */
dev.get("/me", async (c) => {
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  // Ensure at least the demo seed exists so first-time visitors aren't empty
  const allFirst = await db.select().from(schema.merchants).limit(1);
  if (!allFirst[0]) {
    await ensureDemoSeed();
  }

  const allMerchants = await db
    .select()
    .from(schema.merchants)
    .orderBy(desc(schema.merchants.installedAt));

  // Default: prefer the most recent ACTIVE merchant whose access_token is set
  // (real Salla install) over the demo merchant.
  const requestedId = c.req.query("merchantId");
  const realActive = allMerchants.find(
    (m) =>
      !m.uninstalledAt &&
      !!m.accessToken &&
      m.accessToken.length > 0 &&
      m.sallaStoreId !== "demo-1"
  );
  const demo = allMerchants.find((m) => m.sallaStoreId === "demo-1");

  let activeMerchant = allMerchants[0];
  if (requestedId) {
    activeMerchant =
      allMerchants.find((m) => m.id === requestedId) ?? activeMerchant;
  } else if (realActive) {
    activeMerchant = realActive;
  } else if (demo) {
    activeMerchant = demo;
  }

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.merchantId, activeMerchant.id));

  return c.json({
    merchantId: activeMerchant.id,
    merchant: {
      id: activeMerchant.id,
      sallaStoreId: activeMerchant.sallaStoreId,
      name: activeMerchant.name,
      domain: activeMerchant.domain,
      isDemo: activeMerchant.sallaStoreId === "demo-1",
    },
    merchants: allMerchants.map((m) => ({
      id: m.id,
      sallaStoreId: m.sallaStoreId,
      name: m.name,
      domain: m.domain,
      isDemo: m.sallaStoreId === "demo-1",
      uninstalled: !!m.uninstalledAt,
      installedAt: m.installedAt,
    })),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      whatsappDisplayName: u.whatsappDisplayName,
    })),
  });
});

const inboundSchema = z.object({
  conversationId: z.string().uuid().optional(),
  customerPhone: z.string().min(5).optional(),
  customerName: z.string().optional(),
  body: z.string().min(1),
});

dev.post("/whatsapp/simulate-inbound", zValidator("json", inboundSchema), async (c) => {
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const { conversationId, customerPhone, customerName, body } = c.req.valid("json");

  const merchantHeader = c.req.header("X-Merchant-Id");
  if (!merchantHeader) return c.json({ error: "missing_merchant_header" }, 401);

  let convId = conversationId;
  if (!convId) {
    if (!customerPhone) return c.json({ error: "need_conversation_or_phone" }, 400);
    const [conv] = await db
      .insert(schema.conversations)
      .values({
        merchantId: merchantHeader,
        customerPhone,
        customerName: customerName ?? null,
        status: "open",
        lastMessageAt: new Date(),
      })
      .returning();
    convId = conv.id;
  } else {
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), status: "open" })
      .where(eq(schema.conversations.id, convId));
  }

  const [msg] = await db
    .insert(schema.messages)
    .values({
      conversationId: convId,
      direction: "in",
      body,
    })
    .returning();

  return c.json({ ok: true, conversationId: convId, message: msg });
});
