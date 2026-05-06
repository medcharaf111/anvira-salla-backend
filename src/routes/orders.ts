import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { demoAuth } from "../middleware/demo-auth.js";

/**
 * Orders endpoints.
 *   GET /orders             → list mirrored Salla orders
 *   GET /orders/:id         → detail incl. linked tasks + customer thread + suggested timeline
 */
export const orders = new Hono();
orders.use("*", demoAuth);

orders.get("/", async (c) => {
  const merchant = c.get("merchant");
  const rows = await db
    .select()
    .from(schema.sallaOrders)
    .where(eq(schema.sallaOrders.merchantId, merchant.id))
    .orderBy(desc(schema.sallaOrders.createdAt));
  return c.json({ orders: rows });
});

orders.get("/:id", async (c) => {
  const merchant = c.get("merchant");
  const id = c.req.param("id")!;
  const orderRows = await db
    .select()
    .from(schema.sallaOrders)
    .where(
      and(
        eq(schema.sallaOrders.id, id),
        eq(schema.sallaOrders.merchantId, merchant.id)
      )
    )
    .limit(1);
  const order = orderRows[0];
  if (!order) return c.json({ error: "not_found" }, 404);

  // Linked tasks
  const linkedTasks = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.merchantId, merchant.id),
        eq(schema.tasks.sallaOrderId, order.sallaOrderId)
      )
    );

  // Conversations from same customer
  const linkedConvs = order.customerPhone
    ? await db
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.merchantId, merchant.id),
            eq(schema.conversations.customerPhone, order.customerPhone)
          )
        )
        .orderBy(desc(schema.conversations.lastMessageAt))
    : [];

  // Pseudo-timeline derived from status (since we don't store status history)
  const timeline = buildTimeline(order);

  return c.json({
    order,
    tasks: linkedTasks,
    conversations: linkedConvs,
    timeline,
  });
});

function buildTimeline(order: typeof schema.sallaOrders.$inferSelect) {
  const created = order.createdAt;
  const items: { label: string; at: Date; status: "done" | "active" | "pending" }[] = [
    { label: "تم استلام الطلب", at: created, status: "done" },
    {
      label: "قيد التجهيز",
      at: new Date(created.getTime() + 3 * 60 * 60 * 1000),
      status: order.status === "processing" ? "active" : ["shipped", "delivered"].includes(order.status) ? "done" : "pending",
    },
    {
      label: "تم الشحن",
      at: new Date(created.getTime() + 24 * 60 * 60 * 1000),
      status: order.status === "shipped" ? "active" : order.status === "delivered" ? "done" : "pending",
    },
    {
      label: "تم التسليم",
      at: new Date(created.getTime() + 72 * 60 * 60 * 1000),
      status: order.status === "delivered" ? "done" : "pending",
    },
  ];
  if (order.status === "cancelled") {
    return [items[0], { label: "تم الإلغاء", at: order.updatedAt, status: "done" as const }];
  }
  return items;
}
