import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  pgEnum,
  numeric,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

/* ───────────────────────── audit_log_legacy ─────────────────────────
 *
 * Pre-hash-chain audit log. Renamed from `audit_log` in migration
 * 0002a_rename_legacy_audit_log.sql so the new spec'd `audit_log` (with
 * hash chain — see `./audit.ts`) can claim the canonical name.
 *
 * Historical rows live here forever for backwards-compatible reads
 * (e.g. GDPR export `UNION`). New writes go to the new table via
 * `appendAuditSync()` in `apps/web/lib/audit/log.ts`.
 */
export const auditLogsLegacy = pgTable("audit_log_legacy", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  action: text("action").notNull(), // e.g. "agent.update", "flow.delete"
  resource: text("resource").notNull(), // e.g. "agent"
  resourceId: text("resource_id"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ───────────────────────── workspace_invite ───────────────────────── */
export const inviteRoleEnum = pgEnum("workspace_invite_role", ["admin", "editor", "viewer"]);
export const inviteStatusEnum = pgEnum("workspace_invite_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const workspaceInvites = pgTable("workspace_invite", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: inviteRoleEnum("role").notNull().default("editor"),
  status: inviteStatusEnum("status").notNull().default("pending"),
  token: text("token").notNull().unique(),
  invitedByUserId: text("invited_by_user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ───────────────────────── api_key ───────────────────────── */
export const apiKeys = pgTable("api_key", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** SHA-256 hash of the key — actual key only shown once at creation */
  hashedKey: text("hashed_key").notNull().unique(),
  /** Display prefix: "ok_live_abc1...defs" */
  prefix: text("prefix").notNull(),
  scopes: jsonb("scopes")
    .$type<string[]>()
    .default(["agents:read", "agents:write", "flows:read", "flows:write"]),
  createdByUserId: text("created_by_user_id"),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ───────────────────────── outbound webhooks ───────────────────────── */
export const outboundWebhooks = pgTable("outbound_webhook", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(), // HMAC signing
  events: jsonb("events").$type<string[]>().default([]), // e.g. ["agent.responded", "flow.run.failed"]
  enabled: boolean("enabled").notNull().default(true),
  failureCount: integer("failure_count").notNull().default(0),
  lastDeliveredAt: timestamp("last_delivered_at"),
  lastErrorAt: timestamp("last_error_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "succeeded",
  "failed",
]);

export const webhookDeliveries = pgTable("webhook_delivery", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id")
    .notNull()
    .references(() => outboundWebhooks.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  error: text("error"),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at"),
});

/* ───────────────────────── billing (Phase 7) ───────────────────────── */
export const planEnum = pgEnum("workspace_plan", [
  "free",
  "starter",
  "pro",
  "business",
  "enterprise",
]);

export const usageEventKindEnum = pgEnum("usage_event_kind", [
  "agent_message",
  "flow_run",
  "tokens_in",
  "tokens_out",
  "kb_query",
  "webhook_call",
]);

export const usageEvents = pgTable("usage_event", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: usageEventKindEnum("kind").notNull(),
  amount: integer("amount").notNull().default(1),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  agentId: text("agent_id"),
  flowId: text("flow_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspaceBilling = pgTable("workspace_billing", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AuditLogLegacy = typeof auditLogsLegacy.$inferSelect;
export type WorkspaceInvite = typeof workspaceInvites.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type OutboundWebhook = typeof outboundWebhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type WorkspaceBilling = typeof workspaceBilling.$inferSelect;
