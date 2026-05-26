import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  boolean,
  jsonb,
  numeric,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const agentStatusEnum = pgEnum("agent_status", ["active", "inactive", "draft"]);
export const agentKindEnum = pgEnum("agent_kind", ["conversational", "flow"]);
export const agentResponseFormatEnum = pgEnum("agent_response_format", [
  "text",
  "json",
  "markdown",
]);
export const channelTypeEnum = pgEnum("channel_type", [
  "web",
  "widget",
  "whatsapp",
  "telegram",
  "slack",
  "email",
  "api",
]);
export const channelStatusEnum = pgEnum("channel_status", ["active", "inactive"]);
export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "closed",
  "escalated",
]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

export const teams = pgTable("team", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  avatarColor: text("avatar_color").default("#3B3BFF"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agents = pgTable("agent", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model").notNull().default("claude-sonnet-4-6"),
  status: agentStatusEnum("status").notNull().default("draft"),
  kind: agentKindEnum("kind").notNull().default("conversational"),
  flowId: text("flow_id"),
  tools: jsonb("tools").$type<string[]>().default([]),
  variables: jsonb("variables").$type<Record<string, string>>().default({}),
  greeting: text("greeting"),
  fallback: text("fallback"),
  starters: jsonb("starters").$type<string[]>().default([]),
  avatarUrl: text("avatar_url"),
  color: text("color").default("#8b5cf6"),
  maxTurns: integer("max_turns").default(20),
  responseFormat: agentResponseFormatEnum("response_format").notNull().default("text"),
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  temperature: numeric("temperature", { precision: 3, scale: 2 }).default("0.70"),
  maxTokens: integer("max_tokens"),
  // Mnemosyne v1.4 — per-agent memory policy (migration 0036).
  // jsonb to match the dynamic shape ({write_scope_default, read_scopes,
  // sensitive_categories}). The default mirrors the SQL default and is
  // the canonical TS source of truth lives in
  // `packages/mnemosyne/src/policy/index.ts` (DEFAULT_AGENT_MEMORY_POLICY).
  memoryPolicy: jsonb("memory_policy")
    .$type<{
      write_scope_default: "workspace" | "agent" | "conversation";
      read_scopes: Array<"workspace" | "agent" | "conversation">;
      sensitive_categories: string[];
    }>()
    .notNull()
    .default({
      write_scope_default: "workspace",
      read_scopes: ["workspace", "agent"],
      sensitive_categories: [],
    }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const channels = pgTable("channel", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  agentId: text("agent_id"),
  name: text("name").notNull(),
  type: channelTypeEnum("type").notNull(),
  status: channelStatusEnum("status").notNull().default("inactive"),
  /** Public secret used in inbound webhook URLs (e.g. /api/channels/{secret}/webhook) */
  secret: text("secret"),
  /** Encrypted credentials for the channel (bot tokens, OAuth refresh, etc.) */
  credentialsEncrypted: text("credentials_encrypted"),
  /** Visual config: branding, greeting, position, color, etc. */
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const employees = pgTable(
  "employee",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    area: text("area"),
    managerId: text("manager_id"),
    avatarUrl: text("avatar_url"),
    active: boolean("active").notNull().default(true),
    assignedAgentIds: jsonb("assigned_agent_ids").$type<string[]>().default([]),
    /** Hard budget USD/mes. Cuando se supera, el agente devuelve `budget_exceeded`. NULL = sin límite. */
    monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 10, scale: 2 }),
    /** Última alerta enviada (warn70 | warn90 | exceeded), idempotente por mes. */
    lastBudgetAlertLevel: text("last_budget_alert_level"),
    /** Mes calendario de la última alerta (YYYY-MM). Se resetea cada mes. */
    lastBudgetAlertMonth: text("last_budget_alert_month"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Email único por workspace (evita que un seed corrido 2 veces duplique gente)
    uniqWorkspaceEmail: uniqueIndex("uniq_employee_workspace_email").on(t.workspaceId, t.email),
  })
);

export const conversations = pgTable("conversation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  status: conversationStatusEnum("status").notNull().default("open"),
  summary: text("summary"),
  messageCount: integer("message_count").notNull().default(0),
  durationSeconds: integer("duration_seconds"),
  /** Costo total acumulado de la conversación. Sumatoria de message.cost_usd. */
  totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }).default("0"),
  /** Tokens totales acumulados (input + output) en la conversación. */
  totalTokens: integer("total_tokens").default(0),
  /** Phase 5 — Conversations Hub */
  externalId: text("external_id"), // e.g. telegram chat id, widget visitor id
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  tags: jsonb("tags").$type<string[]>().default([]),
  csat: integer("csat"), // 1-5
  deflected: boolean("deflected").notNull().default(false),
  assignedToUserId: text("assigned_to_user_id"),
  takenOverAt: timestamp("taken_over_at"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messages = pgTable("message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  /** Total tokens (input + output) consumidos por este message si role=assistant. */
  tokensUsed: integer("tokens_used"),
  /** Costo USD (precisión 10.6 = ej. 0.001234). NULL si role!=assistant o no LLM. */
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  /** Modelo que generó este message (ej. claude-sonnet-4-6). Null para user msgs. */
  model: text("model"),
  /** Author when role = "system" (operator takeover): user.id */
  authorUserId: text("author_user_id"),
  /** When the operator manually replies, vs an agent response */
  fromOperator: boolean("from_operator").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversationLabels = pgTable("conversation_label", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#8b5cf6"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Channel = typeof channels.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
