import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { schema } from "@orchester/db";
import { withWorkspaceTx } from "@/lib/tenant/context";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { applicableKinds } from "./filters";
import { mergeActivityPages } from "./merge";
import {
  HASHED_KEY_LENGTH,
  foldOutcomeCounts,
  foldSpend,
  matchIntegration,
  sumOutcomeCounts,
  sumSpend,
  type OutcomeCountRow,
  type SpendRow,
} from "./totals";
import {
  ACTIVITY_KINDS,
  MAX_EXPORT_ROWS,
  type ActivityCursor,
  type ActivityFilters,
  type ActivityIntegration,
  type ActivityKind,
  type ActivityNamed,
  type ActivityOutcome,
  type ActivityRow,
  type ActivityTokens,
  type ActivityTotals,
} from "./types";

/**
 * The activity view's reads: one timeline merged from five sources, the
 * totals for a range, and the rows of a CSV export.
 *
 * Pagination. Each source is queried on its own with the same cursor
 * condition `(at, id) < (cursor.at, cursor.id)`, newest first, `limit + 1`
 * rows; `mergeActivityPages` then interleaves them and keeps `limit`. One
 * query per source keeps every query on its own `(workspace_id, <time> DESC)`
 * index and lets each run in its own database context (below), which a single
 * UNION could not.
 *
 * Isolation. Every query names the workspace explicitly. On top of that:
 * - `tool_call`, `usage_event`, `flow_run` (+ `flow_run_step`) and
 *   `conversation` are read inside `withWorkspaceTx`: role `app_user` and
 *   `app.workspace_id` set, so RLS also confines them to the workspace;
 * - `audit_log` is read the way the audit route reads it: inside
 *   `withCrossTenantAdmin`, which bypasses RLS, so the explicit
 *   `workspace_id` filter is the only fence there. Keep it.
 *
 * Time. `at` is the row's time as UTC text with microseconds, formatted by
 * Postgres. Cursors carry that text back, so rows written within the same
 * millisecond (several `defaultNow()` columns) are neither skipped nor
 * repeated. `usage_event`, `flow_run` and `conversation` use `timestamp`
 * without a zone, written in UTC; `tool_call` and `audit_log` use
 * `timestamptz`. Ids are compared with `COLLATE "C"`, the byte order the
 * JavaScript merge uses.
 */

type Tx = Parameters<Parameters<typeof withWorkspaceTx>[1]>[0];

export interface ActivityPage {
  rows: ActivityRow[];
  nextCursor: ActivityCursor | null;
}

/** One page of a source: its rows after the cursor, newest first. */
interface SourceArgs {
  workspaceId: string;
  filters: ActivityFilters;
  cursor: ActivityCursor | null;
  take: number;
}

interface TimeColumn {
  column: AnyPgColumn;
  /** `timestamp` without a zone, holding UTC. */
  naive: boolean;
}

const MAX_ERROR = 300;

function atText(time: TimeColumn): SQL<string> {
  return time.naive
    ? sql<string>`to_char(${time.column}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    : sql<string>`to_char(${time.column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** An ISO instant as the column's type. A zone in the text is ignored by `::timestamp`. */
function instant(time: TimeColumn, iso: string): SQL {
  return time.naive ? sql`${iso}::timestamp` : sql`${iso}::timestamptz`;
}

function inRange(time: TimeColumn, filters: ActivityFilters): SQL[] {
  return [
    sql`${time.column} >= ${instant(time, filters.from.toISOString())}`,
    sql`${time.column} < ${instant(time, filters.to.toISOString())}`,
  ];
}

function afterCursor(time: TimeColumn, id: AnyPgColumn, cursor: ActivityCursor | null): SQL[] {
  if (!cursor) return [];
  const at = instant(time, cursor.at);
  return [
    sql`(${time.column} < ${at} OR (${time.column} = ${at} AND ${id} COLLATE "C" < ${cursor.id}))`,
  ];
}

function newestFirst(time: TimeColumn, id: AnyPgColumn): SQL[] {
  return [desc(time.column), sql`${id} COLLATE "C" DESC`];
}

function idFilter(column: AnyPgColumn, value: string | undefined): SQL[] {
  return value === undefined ? [] : [eq(column, value)];
}

const path = (...parts: string[]) => `/${parts.map(encodeURIComponent).join("/")}`;

function named(id: string | null | undefined): ActivityNamed | null {
  return id ? { id, name: null } : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function cut(text: string | null, max: number): string | null {
  return text && text.length > max ? `${text.slice(0, max)}…` : text;
}

// ── tool_call ───────────────────────────────────────────────────────────────

const toolCallTime: TimeColumn = { column: schema.toolCalls.createdAt, naive: false };

function toolCallFilters(f: ActivityFilters): SQL[] {
  const tc = schema.toolCalls;
  const out = [
    ...idFilter(tc.agentId, f.agentId),
    ...idFilter(tc.flowId, f.flowId),
    ...idFilter(tc.channelId, f.channelId),
    ...idFilter(tc.integrationType, f.integrationType),
    ...idFilter(tc.outcome, f.outcome),
  ];
  if (f.integrationId !== undefined) {
    // A hashed MCP tool name records only the first characters of the id.
    out.push(
      sql`(${tc.integrationId} = ${f.integrationId} OR (char_length(${tc.integrationId}) = ${HASHED_KEY_LENGTH} AND starts_with(${f.integrationId}, ${tc.integrationId})))`
    );
  }
  if (f.ref !== undefined) out.push(sql`starts_with(${tc.ref}, ${f.ref})`);
  return out;
}

async function fetchToolCalls(tx: Tx, a: SourceArgs): Promise<ActivityRow[]> {
  const tc = schema.toolCalls;
  const rows = await tx
    .select({
      id: tc.id,
      at: atText(toolCallTime),
      source: tc.source,
      agentId: tc.agentId,
      conversationId: tc.conversationId,
      channelId: tc.channelId,
      flowId: tc.flowId,
      flowRunId: tc.flowRunId,
      nodeId: tc.nodeId,
      tool: tc.tool,
      integrationType: tc.integrationType,
      integrationId: tc.integrationId,
      ref: tc.ref,
      input: tc.input,
      outcome: tc.outcome,
      errorCode: tc.errorCode,
      error: tc.error,
      durationMs: tc.durationMs,
      resultSize: tc.resultSize,
    })
    .from(schema.toolCalls)
    .where(
      and(
        eq(schema.toolCalls.workspaceId, a.workspaceId),
        ...inRange(toolCallTime, a.filters),
        ...toolCallFilters(a.filters),
        ...afterCursor(toolCallTime, tc.id, a.cursor)
      )
    )
    .orderBy(...newestFirst(toolCallTime, tc.id))
    .limit(a.take);

  return rows.map((r): ActivityRow => ({
    id: r.id,
    at: r.at,
    kind: "tool_call",
    agent: named(r.agentId),
    flow: named(r.flowId),
    channel: named(r.channelId),
    integration:
      r.integrationType || r.integrationId
        ? { type: r.integrationType, id: r.integrationId, name: null }
        : null,
    ref: r.ref,
    outcome: r.outcome as ActivityOutcome,
    tokens: null,
    costUsd: null,
    durationMs: r.durationMs,
    summary: r.ref ? `${r.tool} · ${r.ref}` : r.tool,
    link: r.conversationId
      ? path("conversations", r.conversationId)
      : r.flowId
        ? path("flows", r.flowId)
        : r.agentId
          ? path("agents", r.agentId)
          : null,
    detail: {
      kind: "tool_call",
      source: r.source,
      tool: r.tool,
      input: r.input ?? {},
      errorCode: r.errorCode,
      error: r.error,
      resultSize: r.resultSize,
      conversationId: r.conversationId,
      flowRunId: r.flowRunId,
      nodeId: r.nodeId,
    },
  }));
}

// ── usage_event ─────────────────────────────────────────────────────────────

const usageTime: TimeColumn = { column: schema.usageEvents.createdAt, naive: true };

function usageFilters(f: ActivityFilters): SQL[] {
  const ue = schema.usageEvents;
  return [...idFilter(ue.agentId, f.agentId), ...idFilter(ue.flowId, f.flowId)];
}

function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * Tokens of a usage row. `recordAiUsage` writes the split (`tokensIn`,
 * `tokensOut`, cache, `tokensTotal`); the channel router writes only
 * `tokens`, a total.
 */
function usageTokens(meta: Record<string, unknown>): ActivityTokens | null {
  const tokensIn = metaNumber(meta, "tokensIn");
  const tokensOut = metaNumber(meta, "tokensOut");
  const total =
    metaNumber(meta, "tokensTotal") ??
    metaNumber(meta, "tokens") ??
    (tokensIn !== null || tokensOut !== null ? (tokensIn ?? 0) + (tokensOut ?? 0) : null);
  const tokens: ActivityTokens = {
    in: tokensIn,
    out: tokensOut,
    cacheWrite: metaNumber(meta, "cacheWriteTokens"),
    cacheRead: metaNumber(meta, "cacheReadTokens"),
    total,
  };
  return Object.values(tokens).some((v) => v !== null) ? tokens : null;
}

async function fetchModelUsage(tx: Tx, a: SourceArgs): Promise<ActivityRow[]> {
  const ue = schema.usageEvents;
  const rows = await tx
    .select({
      id: ue.id,
      at: atText(usageTime),
      kind: ue.kind,
      costUsd: ue.costUsd,
      agentId: ue.agentId,
      flowId: ue.flowId,
      metadata: ue.metadata,
    })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.workspaceId, a.workspaceId),
        ...inRange(usageTime, a.filters),
        ...usageFilters(a.filters),
        ...afterCursor(usageTime, ue.id, a.cursor)
      )
    )
    .orderBy(...newestFirst(usageTime, ue.id))
    .limit(a.take);

  return rows.map((r): ActivityRow => {
    const meta = r.metadata ?? {};
    const model = metaString(meta, "model");
    const capability = metaString(meta, "capability");
    const conversationId = metaString(meta, "conversationId");
    const failed = meta.failed === true;
    return {
      id: r.id,
      at: r.at,
      kind: "model_usage",
      agent: named(r.agentId),
      flow: named(r.flowId),
      channel: null,
      integration: null,
      ref: null,
      outcome: null,
      tokens: usageTokens(meta),
      costUsd: toNumber(r.costUsd),
      durationMs: null,
      summary: [model ?? r.kind, capability ?? (model ? r.kind : null), failed ? "failed" : null]
        .filter(Boolean)
        .join(" · "),
      link: conversationId
        ? path("conversations", conversationId)
        : r.flowId
          ? path("flows", r.flowId)
          : r.agentId
            ? path("agents", r.agentId)
            : null,
      detail: {
        kind: "model_usage",
        usageKind: r.kind,
        model,
        capability,
        failed,
        conversationId,
        flowRunId: metaString(meta, "flowRunId"),
        nodeId: metaString(meta, "nodeId"),
      },
    };
  });
}

// ── flow_run ────────────────────────────────────────────────────────────────

const flowRunTime: TimeColumn = { column: schema.flowRuns.startedAt, naive: true };

function flowRunFilters(f: ActivityFilters): SQL[] {
  const fr = schema.flowRuns;
  const out = idFilter(fr.flowId, f.flowId);
  if (f.outcome === "ok") out.push(eq(fr.status, "succeeded"));
  if (f.outcome === "error") out.push(eq(fr.status, "failed"));
  return out;
}

function flowRunOutcome(status: string): ActivityOutcome | null {
  if (status === "succeeded") return "ok";
  if (status === "failed") return "error";
  return null;
}

async function fetchFlowRuns(tx: Tx, a: SourceArgs): Promise<ActivityRow[]> {
  const fr = schema.flowRuns;
  const rows = await tx
    .select({
      id: fr.id,
      at: atText(flowRunTime),
      flowId: fr.flowId,
      status: fr.status,
      triggerSource: fr.triggerSource,
      error: fr.error,
      durationMs: sql<
        number | null
      >`round(extract(epoch from (${fr.completedAt} - ${fr.startedAt})) * 1000)::float8`,
      // The run id is spelled out: in a one-table select drizzle renders a
      // column without its table, and a bare "id" here would be the step's.
      costUsd: sql<
        number | null
      >`(SELECT sum(s.cost_usd)::float8 FROM flow_run_step s WHERE s.run_id = "flow_run"."id")`,
      tokens: sql<
        number | null
      >`(SELECT sum(s.tokens_used)::float8 FROM flow_run_step s WHERE s.run_id = "flow_run"."id")`,
      steps: sql<number>`(SELECT count(*)::int FROM flow_run_step s WHERE s.run_id = "flow_run"."id")`,
    })
    .from(schema.flowRuns)
    .where(
      and(
        eq(schema.flowRuns.workspaceId, a.workspaceId),
        ...inRange(flowRunTime, a.filters),
        ...flowRunFilters(a.filters),
        ...afterCursor(flowRunTime, fr.id, a.cursor)
      )
    )
    .orderBy(...newestFirst(flowRunTime, fr.id))
    .limit(a.take);

  return rows.map((r): ActivityRow => {
    const tokens = toNumber(r.tokens);
    // `manual:<userId>` names who started it; the summary keeps the kind only.
    const trigger = r.triggerSource?.split(":")[0] ?? null;
    return {
      id: r.id,
      at: r.at,
      kind: "flow_run",
      agent: null,
      flow: named(r.flowId),
      channel: null,
      integration: null,
      ref: null,
      outcome: flowRunOutcome(r.status),
      tokens:
        tokens === null
          ? null
          : { in: null, out: null, cacheWrite: null, cacheRead: null, total: tokens },
      costUsd: toNumber(r.costUsd),
      durationMs: toNumber(r.durationMs),
      summary: [r.status, trigger].filter(Boolean).join(" · "),
      link: path("flows", r.flowId),
      detail: {
        kind: "flow_run",
        status: r.status,
        triggerSource: r.triggerSource,
        error: cut(r.error, MAX_ERROR),
        steps: toNumber(r.steps) ?? 0,
      },
    };
  });
}

// ── conversation ────────────────────────────────────────────────────────────

const conversationTime: TimeColumn = { column: schema.conversations.startedAt, naive: true };

function conversationFilters(f: ActivityFilters): SQL[] {
  const c = schema.conversations;
  return [...idFilter(c.agentId, f.agentId), ...idFilter(c.channelId, f.channelId)];
}

async function fetchConversations(tx: Tx, a: SourceArgs): Promise<ActivityRow[]> {
  const c = schema.conversations;
  // Never the summary, the customer or the messages: only counters.
  const rows = await tx
    .select({
      id: c.id,
      at: atText(conversationTime),
      agentId: c.agentId,
      channelId: c.channelId,
      status: c.status,
      messageCount: c.messageCount,
      durationSeconds: c.durationSeconds,
      totalCostUsd: c.totalCostUsd,
      totalTokens: c.totalTokens,
    })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.workspaceId, a.workspaceId),
        ...inRange(conversationTime, a.filters),
        ...conversationFilters(a.filters),
        ...afterCursor(conversationTime, c.id, a.cursor)
      )
    )
    .orderBy(...newestFirst(conversationTime, c.id))
    .limit(a.take);

  return rows.map((r): ActivityRow => ({
    id: r.id,
    at: r.at,
    kind: "conversation",
    agent: named(r.agentId),
    flow: null,
    channel: named(r.channelId),
    integration: null,
    ref: null,
    outcome: null,
    tokens:
      r.totalTokens === null
        ? null
        : { in: null, out: null, cacheWrite: null, cacheRead: null, total: r.totalTokens },
    costUsd: toNumber(r.totalCostUsd),
    durationMs: r.durationSeconds === null ? null : r.durationSeconds * 1000,
    summary: `${r.status} · ${r.messageCount} msg`,
    link: path("conversations", r.id),
    detail: {
      kind: "conversation",
      status: r.status,
      messageCount: r.messageCount,
      durationSeconds: r.durationSeconds,
    },
  }));
}

// ── audit_log ───────────────────────────────────────────────────────────────

const auditTime: TimeColumn = { column: schema.auditLog.createdAt, naive: false };

/** The audit target a filter asks about; `applicableKinds` allows at most one. */
function configChangeFilters(f: ActivityFilters): SQL[] {
  const al = schema.auditLog;
  const target = (type: string, id: string) => [eq(al.targetType, type), eq(al.targetId, id)];
  if (f.agentId !== undefined) return target("agent", f.agentId);
  if (f.flowId !== undefined) return target("flow", f.flowId);
  if (f.channelId !== undefined) return target("channel", f.channelId);
  if (f.integrationId !== undefined) return target("integration", f.integrationId);
  return [];
}

async function fetchConfigChanges(a: SourceArgs): Promise<ActivityRow[]> {
  const al = schema.auditLog;
  const rows = await withCrossTenantAdmin("activity.read", (tx) =>
    tx
      .select({
        id: al.id,
        at: atText(auditTime),
        action: al.action,
        actorUserId: al.actorUserId,
        actorKind: al.actorKind,
        actorName: schema.users.name,
        actorEmail: schema.users.email,
        targetType: al.targetType,
        targetId: al.targetId,
        meta: al.meta,
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorUserId))
      // FORCE RLS is bypassed here: this filter is the workspace fence.
      .where(
        and(
          eq(schema.auditLog.workspaceId, a.workspaceId),
          ...inRange(auditTime, a.filters),
          ...configChangeFilters(a.filters),
          ...afterCursor(auditTime, al.id, a.cursor)
        )
      )
      .orderBy(...newestFirst(auditTime, al.id))
      .limit(a.take)
  );

  return rows.map((r): ActivityRow => {
    const target = (type: string) => (r.targetType === type ? named(r.targetId) : null);
    return {
      id: r.id,
      at: r.at,
      kind: "config_change",
      agent: target("agent"),
      flow: target("flow"),
      channel: target("channel"),
      integration:
        r.targetType === "integration" ? { type: null, id: r.targetId, name: null } : null,
      ref: null,
      outcome: null,
      tokens: null,
      costUsd: null,
      durationMs: null,
      summary: r.targetId ? `${r.action} · ${r.targetType}:${r.targetId}` : r.action,
      link: "/settings#audit",
      detail: {
        kind: "config_change",
        action: r.action,
        actor: {
          kind: r.actorKind,
          userId: r.actorUserId,
          name: r.actorName ?? null,
          email: r.actorEmail ?? null,
        },
        targetType: r.targetType,
        targetId: r.targetId,
        meta: r.meta ?? {},
      },
    };
  });
}

// ── names ───────────────────────────────────────────────────────────────────

interface IntegrationInfo {
  id: string;
  name: string;
  type: string;
}

interface Names {
  agents: Map<string, string>;
  flows: Map<string, string>;
  channels: Map<string, string>;
  integrations: IntegrationInfo[];
}

async function loadNames(
  tx: Tx,
  workspaceId: string,
  want: { agentIds: Iterable<string>; flowIds: Iterable<string>; channelIds: Iterable<string> }
): Promise<Names> {
  const agentIds = [...new Set(want.agentIds)];
  const flowIds = [...new Set(want.flowIds)];
  const channelIds = [...new Set(want.channelIds)];
  const agents = agentIds.length
    ? await tx
        .select({ id: schema.agents.id, name: schema.agents.name })
        .from(schema.agents)
        .where(and(eq(schema.agents.workspaceId, workspaceId), inArray(schema.agents.id, agentIds)))
    : [];
  const flows = flowIds.length
    ? await tx
        .select({ id: schema.flows.id, name: schema.flows.name })
        .from(schema.flows)
        .where(and(eq(schema.flows.workspaceId, workspaceId), inArray(schema.flows.id, flowIds)))
    : [];
  const channels = channelIds.length
    ? await tx
        .select({ id: schema.channels.id, name: schema.channels.name })
        .from(schema.channels)
        .where(
          and(eq(schema.channels.workspaceId, workspaceId), inArray(schema.channels.id, channelIds))
        )
    : [];
  // A workspace has a handful of integrations: load them all, so a hashed
  // MCP key can be matched by prefix.
  const integrations = await tx
    .select({
      id: schema.workspaceIntegrations.id,
      name: schema.workspaceIntegrations.name,
      type: schema.workspaceIntegrations.type,
    })
    .from(schema.workspaceIntegrations)
    .where(eq(schema.workspaceIntegrations.workspaceId, workspaceId));
  return {
    agents: new Map(agents.map((a) => [a.id, a.name])),
    flows: new Map(flows.map((f) => [f.id, f.name])),
    channels: new Map(channels.map((c) => [c.id, c.name])),
    integrations,
  };
}

function withName(ref: ActivityNamed | null, names: Map<string, string>): ActivityNamed | null {
  return ref ? { id: ref.id, name: names.get(ref.id) ?? null } : null;
}

/**
 * The integration a row names, with its name and full id when it can be
 * found. MCP keys may be a prefix (see `matchIntegration`), so only MCP
 * integrations are matched for an MCP row.
 */
function withIntegration(
  integration: ActivityIntegration | null,
  all: IntegrationInfo[]
): ActivityIntegration | null {
  if (!integration?.id) return integration;
  const pool = integration.type === "mcp" ? all.filter((i) => i.type === "mcp") : all;
  const found = matchIntegration(integration.id, pool);
  return found
    ? { type: integration.type ?? found.type, id: found.id, name: found.name }
    : integration;
}

async function nameRows(tx: Tx, workspaceId: string, rows: ActivityRow[]): Promise<void> {
  const names = await loadNames(tx, workspaceId, {
    agentIds: rows.flatMap((r) => (r.agent ? [r.agent.id] : [])),
    flowIds: rows.flatMap((r) => (r.flow ? [r.flow.id] : [])),
    channelIds: rows.flatMap((r) => (r.channel ? [r.channel.id] : [])),
  });
  for (const row of rows) {
    row.agent = withName(row.agent, names.agents);
    row.flow = withName(row.flow, names.flows);
    row.channel = withName(row.channel, names.channels);
    row.integration = withIntegration(row.integration, names.integrations);
  }
}

// ── timeline ────────────────────────────────────────────────────────────────

const WORKSPACE_SOURCES: Record<
  Exclude<ActivityKind, "config_change">,
  (tx: Tx, a: SourceArgs) => Promise<ActivityRow[]>
> = {
  tool_call: fetchToolCalls,
  model_usage: fetchModelUsage,
  flow_run: fetchFlowRuns,
  conversation: fetchConversations,
};

/**
 * One page of the timeline. `limit` is not capped here: the endpoint caps it
 * at 100, the export reads larger pages.
 */
export async function queryActivity(
  workspaceId: string,
  filters: ActivityFilters,
  page: { cursor: ActivityCursor | null; limit: number }
): Promise<ActivityPage> {
  if (!workspaceId) throw new Error("queryActivity: workspaceId is required");
  const kinds = applicableKinds(filters);
  if (kinds.length === 0) return { rows: [], nextCursor: null };
  const args: SourceArgs = { workspaceId, filters, cursor: page.cursor, take: page.limit + 1 };

  const changes = kinds.includes("config_change") ? await fetchConfigChanges(args) : [];
  return withWorkspaceTx(workspaceId, async (tx) => {
    const pages: ActivityRow[][] = [changes];
    for (const kind of kinds) {
      if (kind !== "config_change") pages.push(await WORKSPACE_SOURCES[kind](tx, args));
    }
    const { rows, next } = mergeActivityPages(pages, page.limit);
    await nameRows(tx, workspaceId, rows);
    return { rows, nextCursor: next };
  });
}

/** Rows read per round trip by the export. */
const EXPORT_PAGE = 1_000;

/** Every row of the range, newest first, up to `maxRows`. */
export async function exportActivity(
  workspaceId: string,
  filters: ActivityFilters,
  maxRows = MAX_EXPORT_ROWS
): Promise<{ rows: ActivityRow[]; truncated: boolean }> {
  const rows: ActivityRow[] = [];
  let cursor: ActivityCursor | null = null;
  while (rows.length < maxRows) {
    const page = await queryActivity(workspaceId, filters, {
      cursor,
      limit: Math.min(EXPORT_PAGE, maxRows - rows.length),
    });
    rows.push(...page.rows);
    if (!page.nextCursor) return { rows, truncated: false };
    cursor = page.nextCursor;
  }
  return { rows, truncated: true };
}

// ── totals ──────────────────────────────────────────────────────────────────

/** A number at `metadata -> key`, or null. `key` is one of the constants below. */
function usageMetaNumber(key: string): SQL {
  if (!/^[A-Za-z]+$/.test(key)) throw new Error(`bad metadata key: ${key}`);
  const m = schema.usageEvents.metadata;
  return sql`(CASE WHEN jsonb_typeof(${m} -> '${sql.raw(key)}') = 'number' THEN (${m} ->> '${sql.raw(key)}')::numeric END)`;
}

function usageSums() {
  const total = sql`COALESCE(${usageMetaNumber("tokensTotal")}, ${usageMetaNumber("tokens")},
    CASE WHEN ${usageMetaNumber("tokensIn")} IS NOT NULL OR ${usageMetaNumber("tokensOut")} IS NOT NULL
      THEN COALESCE(${usageMetaNumber("tokensIn")}, 0) + COALESCE(${usageMetaNumber("tokensOut")}, 0) END)`;
  const sum = (expr: SQL) => sql<number>`COALESCE(SUM(${expr}), 0)::float8`;
  return {
    events: sql<number>`count(*)::int`,
    costUsd: sql<number>`COALESCE(SUM(${schema.usageEvents.costUsd}), 0)::float8`,
    tokensIn: sum(usageMetaNumber("tokensIn")),
    tokensOut: sum(usageMetaNumber("tokensOut")),
    cacheWrite: sum(usageMetaNumber("cacheWriteTokens")),
    cacheRead: sum(usageMetaNumber("cacheReadTokens")),
    tokensTotal: sum(total),
  };
}

function spendRow(r: {
  key: string | null;
  events: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  cacheWrite: number;
  cacheRead: number;
  tokensTotal: number;
}): SpendRow {
  return {
    key: r.key,
    events: Number(r.events),
    costUsd: Number(r.costUsd),
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    cacheWrite: Number(r.cacheWrite),
    cacheRead: Number(r.cacheRead),
    tokensTotal: Number(r.tokensTotal),
  };
}

const countAll = () => sql<number>`count(*)::int`;
/** Separates type and id in the key an integration total is folded by. */
const KEY_SEP = "\u0001";

/**
 * Totals for the range and filters: tool calls by tool, agent and
 * integration with their outcomes; spend (cost and tokens of every
 * `usage_event`, router rows included) by agent and by flow; and the row
 * count of each kind. A kind the filters skip contributes nothing.
 */
export async function activityTotals(
  workspaceId: string,
  filters: ActivityFilters
): Promise<ActivityTotals> {
  if (!workspaceId) throw new Error("activityTotals: workspaceId is required");
  const kinds = new Set(applicableKinds(filters));
  const counts = Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, 0])) as Record<
    ActivityKind,
    number
  >;

  if (kinds.has("config_change")) {
    const [row] = await withCrossTenantAdmin("activity.totals", (tx) =>
      tx
        .select({ count: countAll() })
        .from(schema.auditLog)
        // FORCE RLS is bypassed here: this filter is the workspace fence.
        .where(
          and(
            eq(schema.auditLog.workspaceId, workspaceId),
            ...inRange(auditTime, filters),
            ...configChangeFilters(filters)
          )
        )
    );
    counts.config_change = Number(row?.count ?? 0);
  }

  return withWorkspaceTx(workspaceId, async (tx) => {
    const tc = schema.toolCalls;
    const toolWhere = () =>
      and(
        eq(schema.toolCalls.workspaceId, workspaceId),
        ...inRange(toolCallTime, filters),
        ...toolCallFilters(filters)
      );
    let byTool: OutcomeCountRow[] = [];
    let byAgent: OutcomeCountRow[] = [];
    let byIntegration: Array<{ type: string | null; id: string | null } & OutcomeCountRow> = [];
    if (kinds.has("tool_call")) {
      const counted = { outcome: tc.outcome, count: countAll() };
      byTool = (
        await tx
          .select({ key: tc.tool, ...counted })
          .from(schema.toolCalls)
          .where(toolWhere())
          .groupBy(tc.tool, tc.outcome)
      ).map((r) => ({ ...r, count: Number(r.count) }));
      byAgent = (
        await tx
          .select({ key: tc.agentId, ...counted })
          .from(schema.toolCalls)
          .where(toolWhere())
          .groupBy(tc.agentId, tc.outcome)
      ).map((r) => ({ ...r, count: Number(r.count) }));
      byIntegration = (
        await tx
          .select({ type: tc.integrationType, id: tc.integrationId, ...counted })
          .from(schema.toolCalls)
          .where(toolWhere())
          .groupBy(tc.integrationType, tc.integrationId, tc.outcome)
      ).map((r) => ({ ...r, key: null, count: Number(r.count) }));
      counts.tool_call = sumOutcomeCounts(byTool).total;
    }

    let spendByAgent: SpendRow[] = [];
    let spendByFlow: SpendRow[] = [];
    if (kinds.has("model_usage")) {
      const ue = schema.usageEvents;
      const usageWhere = () =>
        and(
          eq(schema.usageEvents.workspaceId, workspaceId),
          ...inRange(usageTime, filters),
          ...usageFilters(filters)
        );
      spendByAgent = (
        await tx
          .select({ key: ue.agentId, ...usageSums() })
          .from(schema.usageEvents)
          .where(usageWhere())
          .groupBy(ue.agentId)
      ).map(spendRow);
      spendByFlow = (
        await tx
          .select({ key: ue.flowId, ...usageSums() })
          .from(schema.usageEvents)
          .where(usageWhere())
          .groupBy(ue.flowId)
      ).map(spendRow);
      counts.model_usage = sumSpend(spendByAgent).events;
    }

    if (kinds.has("flow_run")) {
      const [row] = await tx
        .select({ count: countAll() })
        .from(schema.flowRuns)
        .where(
          and(
            eq(schema.flowRuns.workspaceId, workspaceId),
            ...inRange(flowRunTime, filters),
            ...flowRunFilters(filters)
          )
        );
      counts.flow_run = Number(row?.count ?? 0);
    }
    if (kinds.has("conversation")) {
      const [row] = await tx
        .select({ count: countAll() })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.workspaceId, workspaceId),
            ...inRange(conversationTime, filters),
            ...conversationFilters(filters)
          )
        );
      counts.conversation = Number(row?.count ?? 0);
    }

    const names = await loadNames(tx, workspaceId, {
      agentIds: [...byAgent, ...spendByAgent].flatMap((r) => (r.key ? [r.key] : [])),
      flowIds: spendByFlow.flatMap((r) => (r.key ? [r.key] : [])),
      channelIds: [],
    });

    // Fold integrations by the integration they resolve to, so a hashed MCP
    // key and the full id count as one.
    const integrationOf = new Map<string, ActivityIntegration>();
    const integrationRows = byIntegration.map((r) => {
      const resolved = withIntegration({ type: r.type, id: r.id, name: null }, names.integrations);
      const key = `${resolved?.type ?? ""}${KEY_SEP}${resolved?.id ?? ""}`;
      if (resolved) integrationOf.set(key, resolved);
      return { key, outcome: r.outcome, count: r.count };
    });

    const agentRef = (id: string | null) => withName(named(id), names.agents);
    const flowRef = (id: string | null) => withName(named(id), names.flows);

    return {
      counts,
      toolCalls: sumOutcomeCounts(byTool),
      toolCallsByTool: foldOutcomeCounts(byTool).map(({ key, ...c }) => ({
        tool: key ?? "",
        ...c,
      })),
      toolCallsByAgent: foldOutcomeCounts(byAgent).map(({ key, ...c }) => ({
        agent: agentRef(key),
        ...c,
      })),
      toolCallsByIntegration: foldOutcomeCounts(integrationRows).map(({ key, ...c }) => ({
        integration: integrationOf.get(key ?? "") ?? { type: null, id: null, name: null },
        ...c,
      })),
      usage: sumSpend(spendByAgent),
      usageByAgent: foldSpend(spendByAgent).map(({ key, ...s }) => ({
        agent: agentRef(key),
        ...s,
      })),
      usageByFlow: foldSpend(spendByFlow).map(({ key, ...s }) => ({ flow: flowRef(key), ...s })),
    };
  });
}

// ── filter options ──────────────────────────────────────────────────────────

export interface ActivityFilterOptions {
  agents: Array<{ id: string; name: string }>;
  flows: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string }>;
  integrations: Array<{ id: string; name: string; type: string }>;
}

/** What the page's filter menus offer. */
export async function loadActivityFilterOptions(
  workspaceId: string
): Promise<ActivityFilterOptions> {
  return withWorkspaceTx(workspaceId, async (tx) => ({
    agents: await tx
      .select({ id: schema.agents.id, name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId))
      .orderBy(asc(schema.agents.name)),
    flows: await tx
      .select({ id: schema.flows.id, name: schema.flows.name })
      .from(schema.flows)
      .where(eq(schema.flows.workspaceId, workspaceId))
      .orderBy(asc(schema.flows.name)),
    channels: await tx
      .select({ id: schema.channels.id, name: schema.channels.name })
      .from(schema.channels)
      .where(eq(schema.channels.workspaceId, workspaceId))
      .orderBy(asc(schema.channels.name)),
    integrations: await tx
      .select({
        id: schema.workspaceIntegrations.id,
        name: schema.workspaceIntegrations.name,
        type: schema.workspaceIntegrations.type,
      })
      .from(schema.workspaceIntegrations)
      .where(eq(schema.workspaceIntegrations.workspaceId, workspaceId))
      .orderBy(asc(schema.workspaceIntegrations.name)),
  }));
}
