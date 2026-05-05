import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

/**
 * Idempotent demo seeder.
 *
 * Populates a single demo merchant ("متجر الأناقة") with:
 *   - 3 users (1 owner, 2 agents)
 *   - 5 customers represented as conversations
 *   - 8 mirrored Salla orders
 *   - 4 abandoned carts (recent — eligible for recovery)
 *   - Realistic message threads in each conversation
 *
 * Safe to call repeatedly — checks for existing seed by sallaStoreId.
 *
 * Returns the merchant id + user ids so the API can echo them back to the
 * frontend on first load (the frontend uses these for the demo auth headers).
 */

const DEMO_SALLA_STORE_ID = "demo-1";

export async function ensureDemoSeed() {
  if (!db) {
    console.warn("[seed] DB unavailable — skipping seed");
    return null;
  }

  const existing = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.sallaStoreId, DEMO_SALLA_STORE_ID))
    .limit(1);

  let merchantId: string;
  if (existing[0]) {
    merchantId = existing[0].id;
    console.log(`[seed] demo merchant already exists: ${merchantId}`);
  } else {
    const [created] = await db
      .insert(schema.merchants)
      .values({
        sallaStoreId: DEMO_SALLA_STORE_ID,
        name: "متجر الأناقة",
        domain: "alanaqa.salla.sa",
        email: "owner@alanaqa-demo.sa",
        accessToken: "demo-access-token",
        refreshToken: "demo-refresh-token",
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        plan: "growth",
      })
      .returning();
    merchantId = created.id;
    console.log(`[seed] created demo merchant: ${merchantId}`);
  }

  const existingUsers = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.merchantId, merchantId));

  let users = existingUsers;
  if (existingUsers.length === 0) {
    users = await db
      .insert(schema.users)
      .values([
        {
          merchantId,
          name: "سارة المالك",
          email: "sara@alanaqa-demo.sa",
          whatsappDisplayName: "سارة - مالكة",
          role: "owner",
        },
        {
          merchantId,
          name: "نورا الموظفة",
          email: "nora@alanaqa-demo.sa",
          whatsappDisplayName: "نورا - خدمة العملاء",
          role: "agent",
        },
        {
          merchantId,
          name: "أحمد الموظف",
          email: "ahmed@alanaqa-demo.sa",
          whatsappDisplayName: "أحمد - خدمة العملاء",
          role: "agent",
        },
      ])
      .returning();
    console.log(`[seed] created ${users.length} users`);
  }

  const ownerId = users.find((u) => u.role === "owner")?.id ?? users[0].id;
  const noraId = users.find((u) => u.name.includes("نورا"))?.id ?? users[0].id;

  const existingConvs = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.merchantId, merchantId));

  if (existingConvs.length === 0) {
    type SeedMessage = {
      direction: "in" | "out";
      body: string;
      minutesAgo: number;
      sentByUserId?: string;
    };
    type SeedConversation = {
      customerName: string;
      customerPhone: string;
      sallaCustomerId: string;
      assignedUserId: string | null;
      status: string;
      messages: SeedMessage[];
    };
    const conversationsSeed: SeedConversation[] = [
      {
        customerName: "خالد العتيبي",
        customerPhone: "+966551234567",
        sallaCustomerId: "salla-cust-1",
        assignedUserId: noraId,
        status: "open",
        messages: [
          { direction: "in", body: "السلام عليكم، عندكم العطر اللي شفته بالإنستغرام أمس؟", minutesAgo: 240 },
          { direction: "out", body: "وعليكم السلام 👋 أكيد، أي عطر تقصد بالضبط؟", minutesAgo: 230, sentByUserId: noraId },
          { direction: "in", body: "العطر الذهبي اللي بالعلبة السوداء", minutesAgo: 220 },
          { direction: "in", body: "السعر كم؟", minutesAgo: 219 },
        ],
      },
      {
        customerName: "فاطمة الزهراني",
        customerPhone: "+966509876543",
        sallaCustomerId: "salla-cust-2",
        assignedUserId: null,
        status: "open",
        messages: [
          { direction: "in", body: "هلا، الطلب رقم 1042 وصل وين؟", minutesAgo: 60 },
        ],
      },
      {
        customerName: "محمد القحطاني",
        customerPhone: "+966533445566",
        sallaCustomerId: "salla-cust-3",
        assignedUserId: ownerId,
        status: "open",
        messages: [
          { direction: "in", body: "ابغى أرجع المنتج، ما عجبني المقاس", minutesAgo: 1440 },
          { direction: "out", body: "أهلاً محمد، بالتأكيد. ممكن ترسل لي رقم الطلب؟", minutesAgo: 1430, sentByUserId: ownerId },
          { direction: "in", body: "1038", minutesAgo: 1420 },
        ],
      },
      {
        customerName: "ريم السبيعي",
        customerPhone: "+966587654321",
        sallaCustomerId: "salla-cust-4",
        assignedUserId: noraId,
        status: "closed",
        messages: [
          { direction: "in", body: "الشحن كم يأخذ للرياض؟", minutesAgo: 4320 },
          { direction: "out", body: "للرياض من 2 إلى 3 أيام عمل 🚚", minutesAgo: 4310, sentByUserId: noraId },
          { direction: "in", body: "ممتاز، شكراً", minutesAgo: 4300 },
        ],
      },
      {
        customerName: "عبدالله الدوسري",
        customerPhone: "+966512345678",
        sallaCustomerId: "salla-cust-5",
        assignedUserId: null,
        status: "open",
        messages: [
          { direction: "in", body: "العطر الجديد متى ينزل؟", minutesAgo: 30 },
        ],
      },
    ];

    for (const conv of conversationsSeed) {
      const lastMsg = conv.messages[conv.messages.length - 1];
      const [createdConv] = await db
        .insert(schema.conversations)
        .values({
          merchantId,
          customerPhone: conv.customerPhone,
          customerName: conv.customerName,
          sallaCustomerId: conv.sallaCustomerId,
          assignedUserId: conv.assignedUserId,
          status: conv.status,
          lastMessageAt: new Date(Date.now() - lastMsg.minutesAgo * 60 * 1000),
        })
        .returning();

      for (const msg of conv.messages) {
        await db.insert(schema.messages).values({
          conversationId: createdConv.id,
          direction: msg.direction,
          body: msg.body,
          sentByUserId: msg.sentByUserId ?? null,
          createdAt: new Date(Date.now() - msg.minutesAgo * 60 * 1000),
        });
      }
    }
    console.log(`[seed] created ${conversationsSeed.length} conversations with messages`);
  }

  const existingOrders = await db
    .select()
    .from(schema.sallaOrders)
    .where(eq(schema.sallaOrders.merchantId, merchantId));

  if (existingOrders.length === 0) {
    const ordersSeed = [
      { sallaOrderId: "1042", phone: "+966509876543", status: "shipped", amount: 24500, hoursAgo: 6 },
      { sallaOrderId: "1041", phone: "+966551234567", status: "processing", amount: 18900, hoursAgo: 12 },
      { sallaOrderId: "1040", phone: "+966512345678", status: "delivered", amount: 9900, hoursAgo: 36 },
      { sallaOrderId: "1039", phone: "+966587654321", status: "delivered", amount: 32000, hoursAgo: 72 },
      { sallaOrderId: "1038", phone: "+966533445566", status: "delivered", amount: 14500, hoursAgo: 96 },
      { sallaOrderId: "1037", phone: "+966509876543", status: "delivered", amount: 19800, hoursAgo: 168 },
      { sallaOrderId: "1036", phone: "+966551234567", status: "delivered", amount: 7500, hoursAgo: 200 },
      { sallaOrderId: "1035", phone: "+966587654321", status: "cancelled", amount: 22000, hoursAgo: 240 },
    ];
    for (const o of ordersSeed) {
      await db.insert(schema.sallaOrders).values({
        merchantId,
        sallaOrderId: o.sallaOrderId,
        customerPhone: o.phone,
        status: o.status,
        totalAmount: o.amount,
        currency: "SAR",
        rawPayload: { id: o.sallaOrderId, status: o.status, demo: true },
        createdAt: new Date(Date.now() - o.hoursAgo * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - o.hoursAgo * 60 * 60 * 1000),
      });
    }
    console.log(`[seed] created ${ordersSeed.length} orders`);
  }

  const existingCarts = await db
    .select()
    .from(schema.abandonedCarts)
    .where(eq(schema.abandonedCarts.merchantId, merchantId));

  if (existingCarts.length === 0) {
    const cartsSeed = [
      { sallaCartId: "cart-9001", phone: "+966554443332", amount: 38900, minutesAgo: 45, products: ["عطر شرقي ذهبي", "زيت أرغان مغربي"] },
      { sallaCartId: "cart-9002", phone: "+966505556677", amount: 12500, minutesAgo: 90, products: ["عباية كلاسيكية مقاس M"] },
      { sallaCartId: "cart-9003", phone: "+966512345678", amount: 27500, minutesAgo: 180, products: ["سيروم فيتامين سي", "ماسك الذهب", "غسول طبي"] },
      { sallaCartId: "cart-9004", phone: "+966581112223", amount: 45000, minutesAgo: 600, products: ["ساعة نسائية فضية", "حقيبة جلد طبيعي"] },
    ];
    for (const c of cartsSeed) {
      await db.insert(schema.abandonedCarts).values({
        merchantId,
        sallaCartId: c.sallaCartId,
        customerPhone: c.phone,
        totalAmount: c.amount,
        currency: "SAR",
        rawPayload: { id: c.sallaCartId, products: c.products, demo: true },
        createdAt: new Date(Date.now() - c.minutesAgo * 60 * 1000),
      });
    }
    console.log(`[seed] created ${cartsSeed.length} abandoned carts`);
  }

  return {
    merchantId,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      whatsappDisplayName: u.whatsappDisplayName,
    })),
  };
}
