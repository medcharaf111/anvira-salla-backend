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

  // ---- Tasks ----
  const existingTasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.merchantId, merchantId));

  if (existingTasks.length === 0) {
    const ahmedId = users.find((u) => u.name.includes("أحمد"))?.id ?? users[0].id;
    const tasksSeed = [
      {
        title: "متابعة طلب 1042 — تأخير شحن للرياض",
        description: "العميلة فاطمة سألت عن وضع شحنتها. التأكد من شركة التوصيل اليوم.",
        status: "todo",
        assignedUserId: noraId,
        sallaOrderId: "1042",
      },
      {
        title: "تجهيز عرض ترويجي لرمضان",
        description: "تنسيق مع التسويق على باقة عطور بأسعار خاصة.",
        status: "in_progress",
        assignedUserId: ownerId,
      },
      {
        title: "الرد على استفسار العميل خالد عن العطر الذهبي",
        description: "إرسال السعر والمواصفات وروابط المنتج.",
        status: "todo",
        assignedUserId: noraId,
      },
      {
        title: "إعداد قائمة المنتجات الأكثر مبيعاً للأسبوع",
        description: "تقرير أسبوعي للعمليات.",
        status: "in_progress",
        assignedUserId: ahmedId,
      },
      {
        title: "تحديث وصف منتج 'عباية كلاسيكية' في سلة",
        description: "إضافة قياسات تفصيلية.",
        status: "done",
        assignedUserId: ownerId,
        completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        title: "اتصال بالمراجع محمد القحطاني لتأكيد إرجاع طلب 1038",
        description: "العميل طلب الإرجاع، التأكد من الاستلام.",
        status: "done",
        assignedUserId: ownerId,
        completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ];

    for (const t of tasksSeed) {
      await db.insert(schema.tasks).values({
        merchantId,
        title: t.title,
        description: t.description,
        status: t.status,
        assignedUserId: t.assignedUserId,
        createdByUserId: ownerId,
        sallaOrderId: t.sallaOrderId ?? null,
        completedAt: t.completedAt ?? null,
      });
    }
    console.log(`[seed] created ${tasksSeed.length} tasks`);
  }

  // ---- Customer notes ----
  const existingNotes = await db
    .select()
    .from(schema.customerNotes)
    .where(eq(schema.customerNotes.merchantId, merchantId));

  if (existingNotes.length === 0) {
    const ownerLocal = ownerId;
    const noraLocal = noraId;
    const notesSeed = [
      {
        customerPhone: "+966551234567",
        body: "عميل دائم، يفضل التواصل بعد العصر. اشترى ٣ مرات هذا الشهر.",
        author: ownerLocal,
      },
      {
        customerPhone: "+966509876543",
        body: "حساسة من بعض العطور (المسك القوي). اقتراح: العطور الفواحة الخفيفة.",
        author: noraLocal,
      },
      {
        customerPhone: "+966533445566",
        body: "مرتجع طلب من قبل بسبب المقاس. التحقق من الجدول الإرشادي قبل تأكيد الطلب.",
        author: ownerLocal,
      },
    ];
    for (const n of notesSeed) {
      await db.insert(schema.customerNotes).values({
        merchantId,
        customerPhone: n.customerPhone,
        body: n.body,
        authorUserId: n.author,
      });
    }
    console.log(`[seed] created ${notesSeed.length} customer notes`);
  }

  // ---- Team channels + messages ----
  const existingChannels = await db
    .select()
    .from(schema.teamChannels)
    .where(eq(schema.teamChannels.merchantId, merchantId));

  if (existingChannels.length === 0) {
    const channelsSeed = [
      { name: "general", description: "محادثات الفريق العامة", kind: "channel" },
      { name: "support", description: "تنسيق دعم العملاء", kind: "channel" },
      { name: "marketing", description: "حملات التسويق والعروض", kind: "channel" },
    ];
    const ownerLocal = ownerId;
    const noraLocal = noraId;
    for (const ch of channelsSeed) {
      const [created] = await db
        .insert(schema.teamChannels)
        .values({
          merchantId,
          name: ch.name,
          description: ch.description,
          kind: ch.kind,
        })
        .returning();
      const messagesSeed: { author: string; body: string; minutesAgo: number }[] =
        ch.name === "general"
          ? [
              {
                author: ownerLocal,
                body: "صباح الخير 👋 يومنا اليوم ٢٤ طلب جديد، بداية ممتازة!",
                minutesAgo: 480,
              },
              {
                author: noraLocal,
                body: "صباح النور، خلصت من ١٢ محادثة من الصباح",
                minutesAgo: 470,
              },
              {
                author: ownerLocal,
                body: "ممتاز نورا، استمري على هذا المنوال 🌟",
                minutesAgo: 465,
              },
            ]
          : ch.name === "support"
            ? [
                {
                  author: noraLocal,
                  body: "الموردون أكدوا وصول دفعة العطور الجديدة الأحد",
                  minutesAgo: 360,
                },
                {
                  author: ownerLocal,
                  body: "تمام، نحضر للحملة بعد ما توصل",
                  minutesAgo: 355,
                },
              ]
            : [
                {
                  author: ownerLocal,
                  body: "اقتراح: حملة استرجاع سلات هذا الأسبوع، Anvira تتولى الصياغة",
                  minutesAgo: 240,
                },
              ];
      for (const m of messagesSeed) {
        await db.insert(schema.teamMessages).values({
          channelId: created.id,
          authorUserId: m.author,
          body: m.body,
          createdAt: new Date(Date.now() - m.minutesAgo * 60 * 1000),
        });
      }
    }
    console.log(`[seed] created ${channelsSeed.length} channels with messages`);
  }

  // ---- Workflow templates ----
  const existingWorkflows = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.merchantId, merchantId));

  if (existingWorkflows.length === 0) {
    const workflowsSeed = [
      {
        slug: "abandoned-cart-recovery",
        name: "استرجاع السلات المهجورة",
        description: "إذا ترك عميل سلته بدون إكمال خلال ٣٠ دقيقة، أرسل رسالة استرجاع AI.",
        trigger: "salla.abandoned_cart",
        action: "whatsapp.send_recovery",
        enabled: true,
      },
      {
        slug: "order-confirmation",
        name: "تأكيد إكمال الطلب",
        description: "عند إتمام الطلب، أرسل رسالة شكر تتضمن رابط التتبع.",
        trigger: "salla.order_completed",
        action: "whatsapp.send_thanks",
        enabled: true,
      },
      {
        slug: "appointment-reminder",
        name: "تذكير قبل الموعد",
        description: "قبل ٢٤ ساعة من موعد الزبون، أرسل تذكير واتساب.",
        trigger: "calendar.upcoming_appointment",
        action: "whatsapp.send_reminder",
        enabled: false,
      },
      {
        slug: "complaint-escalation",
        name: "تصعيد الشكاوى",
        description: "عند رصد شكوى من رسالة العميل، أنشئ تاسك للمالك.",
        trigger: "ai.complaint_detected",
        action: "tasks.create_for_owner",
        enabled: false,
      },
      {
        slug: "weekend-handover",
        name: "تسليم نهاية الأسبوع",
        description: "تلخيص محادثات الجمعة الصباحية وإرسالها للموظف المناوب.",
        trigger: "schedule.friday_morning",
        action: "ai.weekly_summary",
        enabled: false,
      },
    ];
    for (const w of workflowsSeed) {
      await db.insert(schema.workflowTemplates).values({
        merchantId,
        slug: w.slug,
        name: w.name,
        description: w.description,
        trigger: w.trigger,
        action: w.action,
        enabled: w.enabled,
      });
    }
    console.log(`[seed] created ${workflowsSeed.length} workflow templates`);
  }

  // ---- Activity log (some sample events) ----
  const existingActivity = await db
    .select()
    .from(schema.activityLog)
    .where(eq(schema.activityLog.merchantId, merchantId));

  if (existingActivity.length === 0) {
    const ownerLocal = ownerId;
    const noraLocal = noraId;
    const activitySeed = [
      { actor: ownerLocal, action: "merchant.installed", kind: "merchant", id: merchantId, hoursAgo: 168 },
      { actor: ownerLocal, action: "user.invited", kind: "user", id: noraLocal, hoursAgo: 167, meta: { name: "نورا" } },
      { actor: noraLocal, action: "conversation.replied", kind: "conversation", id: null, hoursAgo: 4 },
      { actor: ownerLocal, action: "cart.recovered", kind: "abandoned_cart", id: null, hoursAgo: 3 },
      { actor: ownerLocal, action: "task.created", kind: "task", id: null, hoursAgo: 2, meta: { title: "تجهيز عرض ترويجي" } },
      { actor: noraLocal, action: "task.completed", kind: "task", id: null, hoursAgo: 1, meta: { title: "تحديث وصف منتج" } },
      { actor: ownerLocal, action: "workflow.enabled", kind: "workflow", id: null, hoursAgo: 0.5, meta: { slug: "abandoned-cart-recovery" } },
    ];
    for (const a of activitySeed) {
      await db.insert(schema.activityLog).values({
        merchantId,
        actorUserId: a.actor,
        action: a.action,
        targetKind: a.kind,
        targetId: a.id,
        metadata: a.meta ?? null,
        createdAt: new Date(Date.now() - a.hoursAgo * 60 * 60 * 1000),
      });
    }
    console.log(`[seed] created ${activitySeed.length} activity log entries`);
  }

  // ---- Knowledge base ----
  const existingKb = await db
    .select()
    .from(schema.knowledgeEntries)
    .where(eq(schema.knowledgeEntries.merchantId, merchantId));

  if (existingKb.length === 0) {
    const kbSeed = [
      {
        question: "كم تأخذ مدة الشحن؟",
        answer: "الشحن داخل الرياض من 1 إلى 2 يوم عمل، ولبقية مدن المملكة من 2 إلى 4 أيام عمل. شحن مجاني للطلبات فوق 200 ريال.",
        tags: ["شحن", "توصيل"],
      },
      {
        question: "ما هي سياسة الإرجاع؟",
        answer: "نقبل الإرجاع خلال 14 يوم من تاريخ الاستلام، شرط أن يكون المنتج بحالته الأصلية وغير مستخدم. التواصل معنا أولاً عبر الواتساب لتنسيق الإرجاع.",
        tags: ["إرجاع", "سياسة"],
      },
      {
        question: "ما هي وسائل الدفع المتاحة؟",
        answer: "نقبل: مدى، فيزا، ماستركارد، Apple Pay، Tabby (تقسيط)، STC Pay، والدفع عند الاستلام للرياض فقط.",
        tags: ["دفع"],
      },
      {
        question: "كيف أعرف مقاسي الصحيح؟",
        answer: "في صفحة كل منتج تجدون جدول المقاسات. لو احتجتم استشارة، أرسلوا الطول والوزن وسنرشح لكم المقاس الأنسب.",
        tags: ["مقاس", "ملابس"],
      },
      {
        question: "هل العطور أصلية؟",
        answer: "كل العطور أصلية 100% ومن وكلاء معتمدين. كل قنينة عطر فيها باركود يمكنكم التحقق منه عبر تطبيق Authentic.",
        tags: ["عطور", "أصلي"],
      },
    ];
    for (const k of kbSeed) {
      await db.insert(schema.knowledgeEntries).values({
        merchantId,
        question: k.question,
        answer: k.answer,
        tags: k.tags,
      });
    }
    console.log(`[seed] created ${kbSeed.length} knowledge base entries`);
  }

  // ---- Custom workflows (built in visual editor) ----
  const existingCustomWorkflows = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.merchantId, merchantId));

  if (existingCustomWorkflows.length === 0) {
    await db.insert(schema.workflows).values({
      merchantId,
      name: "تذكير عملاء VIP بالعروض",
      description: "كل خميس، أرسل قائمة العروض للعملاء بتقييم VIP",
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 80 }, data: { label: "كل خميس 10:00ص", kind: "schedule" } },
        { id: "filter-1", type: "condition", position: { x: 80, y: 220 }, data: { label: "العملاء VIP فقط", kind: "filter", field: "tag", value: "vip" } },
        { id: "action-1", type: "action", position: { x: 80, y: 360 }, data: { label: "أرسل واتساب: قائمة العروض", kind: "whatsapp.send_template", template: "weekly-offers" } },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "filter-1" },
        { id: "e2", source: "filter-1", target: "action-1" },
      ],
      enabled: false,
    });
    console.log(`[seed] created 1 custom workflow`);
  }

  // ---- API keys ----
  const existingKeys = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.merchantId, merchantId));

  if (existingKeys.length === 0) {
    await db.insert(schema.apiKeys).values({
      merchantId,
      userId: ownerId,
      name: "مفتاح سارة الافتراضي",
      keyPreview: "x9z2",
      keyHash: "demo-seed-hash",
      callCount: 1247,
      lastUsedAt: new Date(Date.now() - 30 * 60 * 1000),
    });
    console.log(`[seed] created 1 demo API key`);
  }

  // ---- Notifications ----
  const existingNotifs = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.merchantId, merchantId));

  if (existingNotifs.length === 0) {
    const notifSeed = [
      { user: noraId, kind: "task.assigned", title: "تاسك جديد", body: "متابعة طلب 1042 — تأخير شحن للرياض", href: "/dashboard/tasks", minutesAgo: 30 },
      { user: ownerId, kind: "cart.recovered", title: "سلة استرجعت", body: "+966554443332 أكمل طلباً بقيمة 389 ر.س بعد رسالة الاسترجاع", href: "/dashboard/carts", minutesAgo: 45 },
      { user: noraId, kind: "mention", title: "ذكرتك سارة في #general", body: "ممتاز نورا، استمري على هذا المنوال 🌟", href: "/dashboard/team", minutesAgo: 60 },
      { user: ownerId, kind: "conversation.unassigned", title: "محادثة بدون موظف", body: "عبدالله الدوسري: العطر الجديد متى ينزل؟", href: "/dashboard/inbox", minutesAgo: 15 },
      { user: ownerId, kind: "ai.complaint_detected", title: "AI رصد شكوى محتملة", body: "محمد القحطاني: ابغى أرجع المنتج، ما عجبني المقاس", href: "/dashboard/inbox", minutesAgo: 90 },
    ];
    for (const n of notifSeed) {
      await db.insert(schema.notifications).values({
        merchantId,
        userId: n.user,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: n.href,
        createdAt: new Date(Date.now() - n.minutesAgo * 60 * 1000),
      });
    }
    console.log(`[seed] created ${notifSeed.length} notifications`);
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
