import { and, eq } from "drizzle-orm";
import { draftCartRecoveryMessage } from "../ai/gemini.js";
import { db, schema } from "../db/index.js";
import { sendWhatsApp } from "../whatsapp/client.js";
import { logActivity } from "./activity.js";

/**
 * Workflow runner — fires automatically when Salla webhook events arrive.
 *
 * Two execution modes:
 *
 *   1. **Template mode**: each row in `workflow_templates` has a hard-coded
 *      `trigger` and `action`. When the matching event arrives and the row
 *      is `enabled`, the corresponding action runs. Built-in actions:
 *        - whatsapp.send_recovery → AI draft + WhatsApp send (cart recovery)
 *        - whatsapp.send_thanks   → thanks message after order completed
 *        - whatsapp.send_reminder → appointment / shipping reminder
 *        - tasks.create_for_owner → create a task assigned to the owner
 *        - ai.weekly_summary      → end-of-week summary (placeholder)
 *
 *   2. **Custom mode**: each row in `workflows` has nodes + edges built in
 *      the visual editor. We walk the graph from any trigger node matching
 *      the event, follow conditions, then execute action nodes.
 *
 * Run-best-effort: failures inside a workflow are logged but don't fail
 * the webhook (Salla would retry indefinitely). Use logActivity for audit.
 */

interface RunContext {
  merchantId: string;
  /** Original Salla event type, e.g. "abandoned.cart" */
  event: string;
  /** Payload passed to actions */
  data: Record<string, unknown>;
}

const TRIGGER_TO_EVENT: Record<string, string[]> = {
  "salla.abandoned_cart": ["abandoned.cart"],
  "salla.order_completed": ["order.created", "order.payment.updated"],
  "salla.order_paid": ["order.payment.updated"],
  "calendar.upcoming_appointment": [],
  "ai.complaint_detected": [],
  "schedule.friday_morning": [],
  "schedule": [],
  "whatsapp.message_received": [],
};

function eventMatches(triggerSlug: string, event: string): boolean {
  const events = TRIGGER_TO_EVENT[triggerSlug] ?? [];
  return events.includes(event);
}

export async function runWorkflowsForEvent(ctx: RunContext): Promise<void> {
  await Promise.all([runTemplates(ctx), runCustomWorkflows(ctx)]);
}

/* ---------- Template mode ---------- */

async function runTemplates(ctx: RunContext): Promise<void> {
  const templates = await db
    .select()
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.merchantId, ctx.merchantId),
        eq(schema.workflowTemplates.enabled, true)
      )
    );

  for (const tpl of templates) {
    if (!eventMatches(tpl.trigger, ctx.event)) continue;
    try {
      await executeAction(tpl.action, ctx);
      await logActivity({
        merchantId: ctx.merchantId,
        actorUserId: null,
        action: "workflow.template_fired",
        targetKind: "workflow_template",
        targetId: tpl.id,
        metadata: { slug: tpl.slug, event: ctx.event },
      });
    } catch (err) {
      console.warn(`[workflow] template ${tpl.slug} failed:`, err);
    }
  }
}

/* ---------- Custom (visual builder) mode ---------- */

interface FlowNode {
  id: string;
  type: "trigger" | "condition" | "action";
  data: Record<string, unknown>;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

async function runCustomWorkflows(ctx: RunContext): Promise<void> {
  const workflows = await db
    .select()
    .from(schema.workflows)
    .where(
      and(
        eq(schema.workflows.merchantId, ctx.merchantId),
        eq(schema.workflows.enabled, true)
      )
    );

  for (const wf of workflows) {
    const nodes = (wf.nodes as unknown as FlowNode[]) ?? [];
    const edges = (wf.edges as unknown as FlowEdge[]) ?? [];

    // Find trigger nodes that match the event
    const matchingTriggers = nodes.filter(
      (n) => n.type === "trigger" && eventMatches(String(n.data.kind), ctx.event)
    );
    if (matchingTriggers.length === 0) continue;

    for (const trigger of matchingTriggers) {
      try {
        await walkGraph(trigger, nodes, edges, ctx);
        await logActivity({
          merchantId: ctx.merchantId,
          actorUserId: null,
          action: "workflow.custom_fired",
          targetKind: "workflow",
          targetId: wf.id,
          metadata: { name: wf.name, event: ctx.event },
        });
      } catch (err) {
        console.warn(`[workflow] custom "${wf.name}" failed:`, err);
      }
    }
  }
}

async function walkGraph(
  startNode: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  ctx: RunContext
): Promise<void> {
  const visited = new Set<string>();
  const queue: FlowNode[] = [startNode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.type === "condition") {
      const passed = evaluateCondition(current, ctx);
      if (!passed) continue;
    } else if (current.type === "action") {
      await executeAction(String(current.data.kind ?? ""), ctx);
    }

    const downstream = edges
      .filter((e) => e.source === current.id)
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n): n is FlowNode => !!n);
    queue.push(...downstream);
  }
}

function evaluateCondition(
  node: FlowNode,
  ctx: RunContext
): boolean {
  const kind = String(node.data.kind ?? "");
  switch (kind) {
    case "filter.amount_gt": {
      const threshold = Number(node.data.value ?? 0);
      const total = (ctx.data.total ?? {}) as Record<string, unknown>;
      const amount = Number(total.amount ?? 0);
      return amount > threshold;
    }
    case "filter.tag":
      // Demo purposes: treat as always-pass (we don't have customer tags wired)
      return true;
    default:
      return true;
  }
}

/* ---------- Action executors ---------- */

async function executeAction(action: string, ctx: RunContext): Promise<void> {
  switch (action) {
    case "whatsapp.send_recovery":
      return executeCartRecovery(ctx);
    case "whatsapp.send_thanks":
    case "whatsapp.send_template":
      return executeOrderThanks(ctx);
    case "whatsapp.send_reminder":
    case "whatsapp.send_ai_reply":
      return executeReminder(ctx);
    case "tasks.create":
    case "tasks.create_for_owner":
      return executeCreateTask(ctx);
    case "salla.update_order_status":
      // Stub — real impl would call Salla API
      console.log("[workflow] salla.update_order_status (stub)");
      return;
    case "ai.summarize_thread":
    case "ai.weekly_summary":
      console.log(`[workflow] ${action} (stub)`);
      return;
    case "team.notify_channel":
      console.log("[workflow] team.notify_channel (stub)");
      return;
    default:
      console.log(`[workflow] unknown action: ${action}`);
  }
}

async function executeCartRecovery(ctx: RunContext): Promise<void> {
  const merchantRows = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, ctx.merchantId))
    .limit(1);
  const merchant = merchantRows[0];
  if (!merchant) return;

  const cart = ctx.data;
  const phone = (cart.customer as { mobile?: string } | undefined)?.mobile ?? null;
  if (!phone) return;

  const sallaCartId = String(cart.id ?? "");
  const cartRows = sallaCartId
    ? await db
        .select()
        .from(schema.abandonedCarts)
        .where(
          and(
            eq(schema.abandonedCarts.merchantId, ctx.merchantId),
            eq(schema.abandonedCarts.sallaCartId, sallaCartId)
          )
        )
        .limit(1)
    : [];
  const cartRow = cartRows[0];

  const productNames = Array.isArray((cart.products ?? []) as unknown[])
    ? (cart.products as { name?: string }[]).map((p) => p.name ?? "").filter(Boolean)
    : [];
  const totalRaw = (cart.total ?? {}) as { amount?: number };
  const totalSar = Math.round((totalRaw.amount ?? 0));

  const draft = await draftCartRecoveryMessage({
    merchantName: merchant.name,
    customerName: null,
    cartTotalSar: totalSar,
    productNames,
  });

  const send = await sendWhatsApp({
    to: phone,
    body: draft.text,
    agentDisplayName: merchant.name,
  });

  // Find or create conversation
  const existingConv = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.merchantId, ctx.merchantId),
        eq(schema.conversations.customerPhone, phone)
      )
    )
    .limit(1);
  let conversationId: string;
  if (existingConv[0]) {
    conversationId = existingConv[0].id;
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), status: "open" })
      .where(eq(schema.conversations.id, conversationId));
  } else {
    const [created] = await db
      .insert(schema.conversations)
      .values({
        merchantId: ctx.merchantId,
        customerPhone: phone,
        status: "open",
        lastMessageAt: new Date(),
      })
      .returning();
    conversationId = created.id;
  }

  await db.insert(schema.messages).values({
    conversationId,
    direction: "out",
    body: draft.text,
    whatsappMessageId: send.messageId || null,
    aiGenerated: true,
  });

  if (cartRow) {
    await db
      .update(schema.abandonedCarts)
      .set({ recoveryMessageSentAt: new Date() })
      .where(eq(schema.abandonedCarts.id, cartRow.id));
  }

  await db.insert(schema.notifications).values({
    merchantId: ctx.merchantId,
    userId: null,
    kind: "cart.recovered",
    title: "أتمتة: استرجاع سلة آلي",
    body: `${phone} — تم إرسال رسالة استرجاع AI تلقائياً`,
    href: "/dashboard/carts",
  });
}

async function executeOrderThanks(ctx: RunContext): Promise<void> {
  const order = ctx.data;
  const phone = (order.customer as { mobile?: string } | undefined)?.mobile ?? null;
  if (!phone) return;

  const merchantRows = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, ctx.merchantId))
    .limit(1);
  const merchant = merchantRows[0];
  if (!merchant) return;

  const orderId = String(order.id ?? "");
  const body = `شكراً لطلبك من ${merchant.name} 🙏\n\nطلبك رقم #${orderId} وصلنا وقيد التجهيز. سنرسل رابط التتبع فور الشحن.`;

  await sendWhatsApp({
    to: phone,
    body,
    agentDisplayName: merchant.name,
  });

  // Persist to conversation
  const existing = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.merchantId, ctx.merchantId),
        eq(schema.conversations.customerPhone, phone)
      )
    )
    .limit(1);
  let convId: string;
  if (existing[0]) {
    convId = existing[0].id;
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), status: "open" })
      .where(eq(schema.conversations.id, convId));
  } else {
    const [created] = await db
      .insert(schema.conversations)
      .values({
        merchantId: ctx.merchantId,
        customerPhone: phone,
        status: "open",
        lastMessageAt: new Date(),
      })
      .returning();
    convId = created.id;
  }
  await db.insert(schema.messages).values({
    conversationId: convId,
    direction: "out",
    body,
    aiGenerated: true,
  });
}

async function executeReminder(ctx: RunContext): Promise<void> {
  console.log("[workflow] executeReminder for event", ctx.event, "(stub)");
}

async function executeCreateTask(ctx: RunContext): Promise<void> {
  const customer = (ctx.data.customer ?? {}) as { mobile?: string };
  const title = `متابعة من حدث ${ctx.event}${customer.mobile ? ` — ${customer.mobile}` : ""}`;
  await db.insert(schema.tasks).values({
    merchantId: ctx.merchantId,
    title,
    description: `تم إنشاء هذه المهمة تلقائياً عبر أتمتة Anvira`,
    status: "todo",
  });
}
