import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Anvira data model — v1 (lean).
 * Covers: merchants, users (agents), conversations, messages, orders mirror.
 * Excluded for v1: tasks, team_chats, workflows, app_center.
 */

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  sallaStoreId: text("salla_store_id").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain"),
  email: text("email"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  plan: text("plan").notNull().default("starter"),
  installedAt: timestamp("installed_at").notNull().defaultNow(),
  uninstalledAt: timestamp("uninstalled_at"),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  whatsappDisplayName: text("whatsapp_display_name"),
  role: text("role").notNull().default("agent"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name"),
  sallaCustomerId: text("salla_customer_id"),
  assignedUserId: uuid("assigned_user_id").references(() => users.id),
  status: text("status").notNull().default("open"),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  whatsappMessageId: text("whatsapp_message_id"),
  sentByUserId: uuid("sent_by_user_id").references(() => users.id),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sallaOrders = pgTable("salla_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  sallaOrderId: text("salla_order_id").notNull(),
  customerPhone: text("customer_phone"),
  status: text("status").notNull(),
  totalAmount: integer("total_amount_minor"),
  currency: text("currency").notNull().default("SAR"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const abandonedCarts = pgTable("abandoned_carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  sallaCartId: text("salla_cart_id").notNull(),
  customerPhone: text("customer_phone"),
  totalAmount: integer("total_amount_minor"),
  currency: text("currency").notNull().default("SAR"),
  recoveredAt: timestamp("recovered_at"),
  recoveryMessageSentAt: timestamp("recovery_message_sent_at"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
