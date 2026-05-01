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
  "condition",
  "http",
  "transform",
  "delay",
  "notify",
  "end",
]);

export interface FlowNodeData {
  type:
    | "trigger"
    | "agent"
    | "condition"
    | "http"
    | "transform"
    | "delay"
    | "notify"
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

export type Flow = typeof flows.$inferSelect;
export type NewFlow = typeof flows.$inferInsert;
export type FlowRun = typeof flowRuns.$inferSelect;
export type NewFlowRun = typeof flowRuns.$inferInsert;
export type FlowRunStep = typeof flowRunSteps.$inferSelect;
export type NewFlowRunStep = typeof flowRunSteps.$inferInsert;
