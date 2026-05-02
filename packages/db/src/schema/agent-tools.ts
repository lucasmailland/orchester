import { pgTable, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { agents } from "./core";

export const agentToolKindEnum = pgEnum("agent_tool_kind", [
  "http_request",
  "web_search",
  "calculator",
  "current_time",
  "knowledge_search",
  "flow_call",
  "custom",
]);

export const agentTools = pgTable("agent_tool", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  kind: agentToolKindEnum("kind").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentEvals = pgTable("agent_eval", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  input: text("input").notNull(),
  expectedOutput: text("expected_output"),
  expectedToolCalls: jsonb("expected_tool_calls").$type<string[]>().default([]),
  lastResult: text("last_result"),
  lastStatus: text("last_status"), // "pass" | "fail" | null
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AgentTool = typeof agentTools.$inferSelect;
export type NewAgentTool = typeof agentTools.$inferInsert;
export type AgentEval = typeof agentEvals.$inferSelect;
export type NewAgentEval = typeof agentEvals.$inferInsert;
