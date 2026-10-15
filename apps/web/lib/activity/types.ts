/**
 * Shared shapes of the activity view: what `GET /api/workspaces/[slug]/activity`
 * returns and what the page renders. No server imports, so client components
 * can use the constants and types.
 */

/**
 * The sources the activity view merges into one timeline:
 * - `tool_call`: one row per tool call (`tool_call` table).
 * - `model_usage`: one row per model call that was metered (`usage_event`).
 * - `flow_run`: one row per flow run (`flow_run`).
 * - `conversation`: one row per conversation, at the time it started.
 * - `config_change`: one row per entry of the tamper-evident `audit_log`.
 */
export const ACTIVITY_KINDS = [
  "tool_call",
  "model_usage",
  "flow_run",
  "conversation",
  "config_change",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_OUTCOMES = ["ok", "error", "refused"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

/** Longest range one request may cover. */
export const MAX_RANGE_DAYS = 92;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
/** Most rows one CSV export may hold. */
export const MAX_EXPORT_ROWS = 10_000;

export interface ActivityFilters {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
  /** Never empty: every kind when the request named none. */
  kinds: ActivityKind[];
  agentId?: string | undefined;
  flowId?: string | undefined;
  channelId?: string | undefined;
  integrationType?: string | undefined;
  integrationId?: string | undefined;
  outcome?: ActivityOutcome | undefined;
  /** Prefix of a tool call's `ref`, e.g. `odoo:` or `odoo:4512`. */
  ref?: string | undefined;
}

/**
 * Position in the timeline: the last row a page returned. `at` is a UTC
 * timestamp with microseconds (`2026-01-02T03:04:05.123456Z`), the precision
 * Postgres keeps, so two rows within the same millisecond are not confused.
 */
export interface ActivityCursor {
  at: string;
  id: string;
}

export interface ActivityNamed {
  id: string;
  /** Null when the object no longer exists. */
  name: string | null;
}

export interface ActivityIntegration {
  type: string | null;
  id: string | null;
  name: string | null;
}

export interface ActivityTokens {
  in: number | null;
  out: number | null;
  cacheWrite: number | null;
  cacheRead: number | null;
  total: number | null;
}

export interface ToolCallDetail {
  kind: "tool_call";
  source: string;
  tool: string;
  /** Sanitized when it was recorded: no credentials, long values cut. */
  input: Record<string, unknown>;
  errorCode: string | null;
  error: string | null;
  resultSize: number | null;
  conversationId: string | null;
  flowRunId: string | null;
  nodeId: string | null;
}

export interface ModelUsageDetail {
  kind: "model_usage";
  usageKind: string;
  model: string | null;
  capability: string | null;
  failed: boolean;
  conversationId: string | null;
  flowRunId: string | null;
  nodeId: string | null;
}

export interface FlowRunDetail {
  kind: "flow_run";
  status: string;
  triggerSource: string | null;
  /** Cut to a few hundred characters. */
  error: string | null;
  steps: number;
}

export interface ConversationDetail {
  kind: "conversation";
  status: string;
  messageCount: number;
  durationSeconds: number | null;
}

export interface ConfigChangeDetail {
  kind: "config_change";
  action: string;
  actor: { kind: string; userId: string | null; name: string | null; email: string | null };
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
}

export type ActivityDetail =
  ToolCallDetail | ModelUsageDetail | FlowRunDetail | ConversationDetail | ConfigChangeDetail;

export interface ActivityRow {
  /** Id of the source row; unique within its kind. */
  id: string;
  /** UTC with microseconds; see `ActivityCursor.at`. */
  at: string;
  kind: ActivityKind;
  agent: ActivityNamed | null;
  flow: ActivityNamed | null;
  channel: ActivityNamed | null;
  integration: ActivityIntegration | null;
  ref: string | null;
  outcome: ActivityOutcome | null;
  tokens: ActivityTokens | null;
  costUsd: number | null;
  durationMs: number | null;
  /** Short text built from identifiers only, never from message content. */
  summary: string;
  /** Path of the origin relative to the workspace (`/conversations/<id>`), or null. */
  link: string | null;
  detail: ActivityDetail;
}

export interface OutcomeCounts {
  total: number;
  ok: number;
  error: number;
  refused: number;
}

export interface SpendTotals {
  events: number;
  costUsd: number;
  tokens: ActivityTokens;
}

export interface ActivityTotals {
  /** Rows per kind for the range and filters; 0 for a kind that was skipped. */
  counts: Record<ActivityKind, number>;
  toolCalls: OutcomeCounts;
  toolCallsByTool: Array<{ tool: string } & OutcomeCounts>;
  toolCallsByAgent: Array<{ agent: ActivityNamed | null } & OutcomeCounts>;
  toolCallsByIntegration: Array<{ integration: ActivityIntegration } & OutcomeCounts>;
  usage: SpendTotals;
  usageByAgent: Array<{ agent: ActivityNamed | null } & SpendTotals>;
  usageByFlow: Array<{ flow: ActivityNamed | null } & SpendTotals>;
}

export interface ActivityResponse {
  rows: ActivityRow[];
  nextCursor: string | null;
  /** Only on the first page (no cursor). */
  totals: ActivityTotals | null;
}

/** What the page's filter menus offer. */
export interface ActivityFilterOptions {
  agents: Array<{ id: string; name: string }>;
  flows: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string }>;
  integrations: Array<{ id: string; name: string; type: string }>;
}
