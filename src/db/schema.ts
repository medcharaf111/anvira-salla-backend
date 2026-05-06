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
 * Anvira data model.
 *
 * Covers:
 *   - Salla merchants + their team users
 *   - WhatsApp conversations + messages
 *   - Salla orders mirror + abandoned carts
 *   - Tasks linked to conversations / orders
 *   - Customer notes (CRM)
 *   - Activity log (audit trail)
 *   - Internal team chat (channels + messages)
 *   - Workflow templates (toggleable automations)
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

/* ---------- Tasks ---------- */
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"),
  assignedUserId: uuid("assigned_user_id").references(() => users.id),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  sallaOrderId: text("salla_order_id"),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ---------- Customer notes (CRM) ---------- */
export const customerNotes = pgTable("customer_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  customerPhone: text("customer_phone").notNull(),
  body: text("body").notNull(),
  authorUserId: uuid("author_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ---------- Activity log ---------- */
export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  targetKind: text("target_kind"),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ---------- Team chat ---------- */
export const teamChannels = pgTable("team_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("channel"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teamMessages = pgTable("team_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => teamChannels.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  mentions: jsonb("mentions"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ---------- Workflow templates ---------- */
export const workflowTemplates = pgTable("workflow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  trigger: text("trigger").notNull(),
  action: text("action").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ---------- Custom workflows (built via visual editor) ---------- */
export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** React-flow nodes array — node types: trigger | condition | action */
  nodes: jsonb("nodes").notNull().default([]),
  /** React-flow edges array */
  edges: jsonb("edges").notNull().default([]),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ---------- Knowledge base ---------- */
export const knowledgeEntries = pgTable("knowledge_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  tags: jsonb("tags").default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ---------- Personal API keys ---------- */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Last 4 chars of the actual key for UI display ("...x9z2") */
  keyPreview: text("key_preview").notNull(),
  /** SHA-256 hash of the actual key. Real key shown only at creation. */
  keyHash: text("key_hash").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  /** Display-only counter for the demo. Bumped by stub middleware. */
  callCount: integer("call_count").notNull().default(0),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ---------- Notifications (in-app inbox for users) ---------- */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  /** Target user (null = all team members) */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** e.g. mention | task.assigned | cart.recovered | conversation.assigned */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  /** Target link to navigate to on click (e.g. /dashboard/inbox?conv=...) */
  href: text("href"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
