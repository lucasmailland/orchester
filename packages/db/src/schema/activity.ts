import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

/* ───────────────────────── tool_call ─────────────────────────
 *
 * One row per tool call made by an agent (`executeTool`) or by a flow
 * `integration` step. Created by migration 0064_tool_call.sql, which also
 * holds the CHECK constraints, the indexes and the RLS policies.
 *
 * Append-only audit trail: no UPDATE policy, and no foreign keys to agent,
 * flow, flow_run or conversation, so rows outlive what they refer to. The
 * tool's output is never stored, only its size. Written by
 * `apps/web/lib/activity/tool-calls.ts`.
 */
export const toolCalls = pgTable("tool_call", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** channel | test_chat | api | flow_agent | flow_step | mcp_server (CHECK in SQL). */
  source: text("source").notNull(),
  agentId: text("agent_id"),
  conversationId: text("conversation_id"),
  channelId: text("channel_id"),
  flowId: text("flow_id"),
  flowRunId: text("flow_run_id"),
  nodeId: text("node_id"),
  /** Tool name as the model saw it, or `<integration>::<action>` for a flow step. */
  tool: text("tool").notNull(),
  integrationType: text("integration_type"),
  integrationId: text("integration_id"),
  /** Short pointer to the business object the call was about, e.g. `odoo:4512`. */
  ref: text("ref"),
  /** Sanitized input: no credentials, long values cut. Never the output. */
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  /** ok | error | refused (CHECK in SQL). */
  outcome: text("outcome").notNull(),
  errorCode: text("error_code"),
  error: text("error"),
  durationMs: integer("duration_ms").notNull(),
  /** JSON length of what the tool returned; null when it threw or is not serializable. */
  resultSize: integer("result_size"),
});

export type ToolCallRow = typeof toolCalls.$inferSelect;
export type NewToolCallRow = typeof toolCalls.$inferInsert;
