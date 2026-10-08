import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  jsonb,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { agents } from "./core";

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
  /**
   * El run llegó a un `wait_human` y espera que una persona decida. No es un
   * estado de error: el worker soltó el job y la corrida va a continuar cuando
   * alguien responda, en otro proceso y quizás días después.
   *
   * Antes de esto, `wait_human` escribía una variable que nadie leía y el motor
   * seguía de largo: un flow que decía "esperá aprobación" mergeaba igual.
   */
  "paused",
]);
export const flowNodeTypeEnum = pgEnum("flow_node_type", [
  "trigger",
  "agent",
  "kb_search",
  "generate_image",
  "embed_text",
  "llm_prompt",
  "generate_video",
  "text_to_speech",
  "transcribe",
  "rerank",
  "generate_avatar",
  "generate_music",
  "ocr_extract",
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

/**
 * TS-side union of flow node types. Must mirror `flowNodeTypeEnum` above —
 * if you add a type to the enum, add it here. The compiler doesn't enforce
 * this relationship; we keep them aligned by convention.
 */
export interface FlowNodeData {
  type:
    | "trigger"
    | "agent"
    | "kb_search"
    | "generate_image"
    | "embed_text"
    | "llm_prompt"
    | "generate_video"
    | "text_to_speech"
    | "transcribe"
    | "rerank"
    | "generate_avatar"
    | "generate_music"
    | "ocr_extract"
    | "condition"
    | "switch"
    | "http"
    | "integration"
    | "transform"
    | "spreadsheet"
    | "delay"
    | "notify"
    | "code"
    | "loop_for_each"
    | "parallel"
    | "try_catch"
    | "subflow"
    | "wait_human"
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
  /** Markdown specification: what the flow does and why. */
  spec: text("spec"),
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

  /**
   * Dónde retomar cuando alguien apruebe. El recorrido de nodos es recursivo,
   * así que la posición vive en la pila de JavaScript y no sobrevive al
   * proceso: hay que guardarla explícitamente.
   *
   * `pausedNodeId` es el `wait_human` que frenó; se retoma por sus aristas de
   * salida. `pausedVariables` es el contexto completo en ese momento — sin él,
   * retomar sería empezar de cero.
   */
  pausedNodeId: text("paused_node_id"),
  pausedVariables: jsonb("paused_variables").$type<Record<string, unknown>>(),
  pausedAt: timestamp("paused_at"),
  /**
   * Secreto de un solo uso que viaja en el enlace de aprobación. Sin esto,
   * cualquiera que adivine un runId podría aprobar un merge a producción.
   */
  approvalToken: text("approval_token"),
  /** Quién decidió y qué. Queda para auditoría, no lo usa el motor. */
  resolvedBy: text("resolved_by"),
  resolvedDecision: text("resolved_decision"),
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
  /**
   * AI trace of the step: who ran, which model answered, what it cost.
   * Recorded on the step because the graph can change after the run. All
   * nullable: only AI steps fill them.
   */
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  /** Snapshot of the agent's name at run time; survives renames and deletions. */
  agentName: text("agent_name"),
  /** The model that actually answered (after any fallback). */
  model: text("model"),
  tokensUsed: integer("tokens_used"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
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
  /** Markdown specification: what the flow does and why. */
  spec: text("spec"),
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
