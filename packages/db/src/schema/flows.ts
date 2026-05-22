import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const flowStatusEnum = pgEnum("flow_status", ["draft", "active", "paused"]);
export const flowTriggerEnum = pgEnum("flow_trigger_type", [
  "manual",
  "webhook",
  "schedule",
  "conversation",
]);
export const flowRunStatusEnum = pgEnum("flow_run_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const flowNodeTypeEnum = pgEnum("flow_node_type", [
  "trigger",
  "agent",
  "kb_search",
  "generate_image",
  "embed_text",
  "condition",
  "switch",
  "http",
  "integration",
  "transform",
  "spreadsheet",
  "delay",
  "notify",
  "code",
  "loop_for_each",
  "parallel",
  "try_catch",
  "subflow",
  "wait_human",
  "note",
  "end",
]);

export interface FlowNodeData {
  type:
    | "trigger"
    | "agent"
    | "kb_search"
    | "condition"
    | "switch"
    | "http"
    | "integration"
    | "transform"
    | "spreadsheet"
    | "delay"
    | "code"
    | "loop_for_each"
    | "parallel"
    | "try_catch"
    | "subflow"
    | "wait_human"
    | "notify"
    | "note"
    | "end";
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowEdgeData {
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export const flows = pgTable("flow", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: flowStatusEnum("status").notNull().default("draft"),
  trigger: flowTriggerEnum("trigger").notNull().default("manual"),
  triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().default({}),
  nodes: jsonb("nodes").$type<Array<{ id: string } & FlowNodeData>>().default([]),
  edges: jsonb("edges").$type<Array<{ id: string } & FlowEdgeData>>().default([]),
  variables: jsonb("variables").$type<Record<string, unknown>>().default({}),
  version: integer("version").notNull().default(1),
  lastRunAt: timestamp("last_run_at"),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const flowRuns = pgTable("flow_run", {
  id: text("id").primaryKey(),
  flowId: text("flow_id")
    .notNull()
    .references(() => flows.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  status: flowRunStatusEnum("status").notNull().default("pending"),
  triggerSource: text("trigger_source"), // "manual:userId", "webhook", "schedule"
  input: jsonb("input").$type<Record<string, unknown>>().default({}),
  output: jsonb("output").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const flowRunSteps = pgTable("flow_run_step", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => flowRuns.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(), // node.id within flow.nodes JSON
  nodeType: flowNodeTypeEnum("node_type").notNull(),
  status: flowRunStatusEnum("status").notNull().default("pending"),
  input: jsonb("input").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const flowVersions = pgTable("flow_version", {
  id: text("id").primaryKey(),
  flowId: text("flow_id")
    .notNull()
    .references(() => flows.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  label: text("label"),
  nodes: jsonb("nodes").$type<Array<{ id: string } & FlowNodeData>>().default([]),
  edges: jsonb("edges").$type<Array<{ id: string } & FlowEdgeData>>().default([]),
  variables: jsonb("variables").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const flowWebhooks = pgTable("flow_webhook", {
  id: text("id").primaryKey(),
  flowId: text("flow_id")
    .notNull()
    .references(() => flows.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(), // path component used in /api/webhooks/{secret}
  hmacKey: text("hmac_key"), // optional HMAC signing key
  enabled: boolean("enabled").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const flowSchedules = pgTable("flow_schedule", {
  id: text("id").primaryKey(),
  flowId: text("flow_id")
    .notNull()
    .references(() => flows.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  cron: text("cron").notNull(), // e.g. "*/5 * * * *"
  timezone: text("timezone").notNull().default("UTC"),
  enabled: boolean("enabled").notNull().default(true),
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const flowTemplates = pgTable("flow_template", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  nodes: jsonb("nodes").$type<Array<{ id: string } & FlowNodeData>>().default([]),
  edges: jsonb("edges").$type<Array<{ id: string } & FlowEdgeData>>().default([]),
  variables: jsonb("variables").$type<Record<string, unknown>>().default({}),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Flow = typeof flows.$inferSelect;
export type NewFlow = typeof flows.$inferInsert;
export type FlowRun = typeof flowRuns.$inferSelect;
export type NewFlowRun = typeof flowRuns.$inferInsert;
export type FlowRunStep = typeof flowRunSteps.$inferSelect;
export type FlowVersion = typeof flowVersions.$inferSelect;
export type FlowWebhook = typeof flowWebhooks.$inferSelect;
export type FlowSchedule = typeof flowSchedules.$inferSelect;
export type FlowTemplate = typeof flowTemplates.$inferSelect;
export type NewFlowRunStep = typeof flowRunSteps.$inferInsert;
