import { desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, schema } from "../db/index.js";
import { ensureDemoSeed } from "../seed/demo-seed.js";
import { runWorkflowsForEvent } from "../services/workflow-runner.js";

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

  let users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.merchantId, activeMerchant.id));

  // Lazy-create an owner user for real Salla merchants that don't have any
  // (e.g. installs that happened before the auto-user-creation logic shipped).
  if (users.length === 0 && activeMerchant.sallaStoreId !== "demo-1") {
    await db.insert(schema.users).values({
      merchantId: activeMerchant.id,
      name: activeMerchant.name,
      email: activeMerchant.email ?? `owner+${activeMerchant.sallaStoreId}@salla-merchant.local`,
      whatsappDisplayName: activeMerchant.name,
      role: "owner",
    });
    users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.merchantId, activeMerchant.id));
  }

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

/**
 * Realistic Saudi-context fake data generators for the "simulate" buttons.
 */
const SAUDI_NAMES = [
  "سارة الحربي", "محمد القحطاني", "نوف الشمري", "عبدالله الدوسري",
  "ريم العتيبي", "خالد الزهراني", "هند الشهري", "فيصل المالكي",
  "لينا السبيعي", "تركي الجهني", "أمل الرشيدي", "أحمد المطيري",
];
const FAKE_PRODUCTS = [
  ["عطر شرقي ذهبي", "زيت أرغان مغربي"],
  ["عباية كلاسيكية", "حذاء جلد طبيعي"],
  ["سيروم فيتامين سي", "ماسك الذهب", "غسول طبي"],
  ["ساعة نسائية فضية", "حقيبة جلد"],
  ["كحل عربي", "مسك أبيض"],
  ["حذاء رياضي", "تيشيرت قطن"],
];
const SAMPLE_INBOUND = [
  "السلام عليكم، عندكم العطر اللي شفته بالإنستغرام؟",
  "الطلب وصل وين؟ أبي رقم التتبع",
  "ممكن أرجع المنتج، ما عجبني المقاس",
  "كم سعر التوصيل لجدة؟",
  "متى ينزل المنتج الجديد؟",
  "تقبلون مدى؟",
  "في خصم على الباقات؟",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomPhone(): string {
  const prefix = pick(["050", "053", "055", "056", "058"]);
  let rest = "";
  for (let i = 0; i < 7; i++) rest += String(Math.floor(Math.random() * 10));
  return `+966${prefix.slice(1)}${rest}`;
}

dev.post("/simulate/inbound-conversation", async (c) => {
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const merchantId = c.req.header("X-Merchant-Id");
  if (!merchantId) return c.json({ error: "missing_merchant_header" }, 401);

  const customerName = pick(SAUDI_NAMES);
  const customerPhone = randomPhone();
  const body = pick(SAMPLE_INBOUND);

  const [conv] = await db
    .insert(schema.conversations)
    .values({
      merchantId,
      customerPhone,
      customerName,
      sallaCustomerId: `sim-${Date.now()}`,
      status: "open",
      lastMessageAt: new Date(),
    })
    .returning();
  const [msg] = await db
    .insert(schema.messages)
    .values({
      conversationId: conv.id,
      direction: "in",
      body,
    })
    .returning();
  return c.json({ ok: true, conversation: conv, message: msg });
});

dev.post("/simulate/order", async (c) => {
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const merchantId = c.req.header("X-Merchant-Id");
  if (!merchantId) return c.json({ error: "missing_merchant_header" }, 401);

  const status = pick(["processing", "shipped", "delivered", "delivered", "delivered"]);
  const products = pick(FAKE_PRODUCTS);
  const amount = Math.round((50 + Math.random() * 950) * 100); // SAR in minor units
  const sallaOrderId = `${10000 + Math.floor(Math.random() * 89999)}`;

  const customerPhone = randomPhone();
  const [order] = await db
    .insert(schema.sallaOrders)
    .values({
      merchantId,
      sallaOrderId,
      customerPhone,
      status,
      totalAmount: amount,
      currency: "SAR",
      rawPayload: { id: sallaOrderId, status, products, simulated: true },
    })
    .returning();

  // Fire enabled workflows (e.g. order-confirmation template auto-sends thanks)
  await runWorkflowsForEvent({
    merchantId,
    event: "order.created",
    data: {
      id: sallaOrderId,
      status,
      customer: { mobile: customerPhone },
      total: { amount: amount / 100, currency: "SAR" },
      products: products.map((p) => ({ name: p })),
    },
  });

  return c.json({ ok: true, order });
});

dev.post("/simulate/abandoned-cart", async (c) => {
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const merchantId = c.req.header("X-Merchant-Id");
  if (!merchantId) return c.json({ error: "missing_merchant_header" }, 401);

  const products = pick(FAKE_PRODUCTS);
  const amount = Math.round((100 + Math.random() * 800) * 100);
  const minutesAgo = Math.floor(Math.random() * 600);
  const customerPhone = randomPhone();
  const sallaCartId = `cart-sim-${Date.now()}`;

  const [cart] = await db
    .insert(schema.abandonedCarts)
    .values({
      merchantId,
      sallaCartId,
      customerPhone,
      totalAmount: amount,
      currency: "SAR",
      rawPayload: { products, simulated: true },
      createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
    })
    .returning();

  // Fire enabled workflows — typically the cart-recovery template
  // auto-drafts and sends a Gemini WhatsApp message
  await runWorkflowsForEvent({
    merchantId,
    event: "abandoned.cart",
    data: {
      id: sallaCartId,
      customer: { mobile: customerPhone },
      total: { amount: amount / 100, currency: "SAR" },
      products: products.map((p) => ({ name: p })),
    },
  });

  return c.json({ ok: true, cart });
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
