// apps/web/tests/integration/activity/activity.spec.ts
//
// The activity view against a real Postgres (testcontainer): two workspaces
// hold rows at the same instants in every source, and everything the query
// layer and the two endpoints return must come from the caller's workspace
// only, in timeline order, across pages.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The global vitest.setup.ts stubs out @orchester/db; integration tests need
// the real module, imported dynamically once the container is up.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

// Session lookup goes through better-auth; the routes only need the user id.
const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({
    user: { id: auth.userId, email: "", name: "" },
    workspace: { id: "", name: "", slug: "" },
    role: "viewer",
  }),
}));

import { createId } from "@paralleldrive/cuid2";
import { setupTestDb } from "../../fixtures/db";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { ACTIVITY_KINDS, type ActivityFilters, type ActivityRow } from "@/lib/activity/types";
import { compareActivityDesc } from "@/lib/activity/merge";

type Sql = Awaited<ReturnType<typeof setupTestDb>>["sql"];

let sql: Sql;
let wsA: WsFixture;
let wsB: WsFixture;
let query: typeof import("@/lib/activity/query");
let appendAuditSync: typeof import("@/lib/audit/log").appendAuditSync;

/** Seconds after the base instant, with optional extra microseconds, as a UTC ISO string. */
let base: number;
const t = (seconds: number, micros = 0) => {
  const ms = base + Math.floor(seconds * 1000);
  const iso = new Date(ms).toISOString(); // 2026-..T..:..:..SSSZ
  const extra = String(micros).padStart(3, "0");
  return `${iso.slice(0, 23)}${extra}Z`;
};

interface Seeded {
  ids: Set<string>;
  integrationId: string;
  flowId: string;
  channelId: string;
  conversationId: string;
  runId: string;
  agent1: string;
  agent2: string;
  tc: { mcpOk: string; mcpHashed: string; odooStep: string; odooRefused: string };
  ue: { chat: string; router: string; flow: string; routerLater: string };
  auditId: string;
}

let A: Seeded;
let B: Seeded;
/** Every row of workspace A, in timeline order. */
let expectedA: Array<{ at: string; id: string }>;

async function seed(ws: WsFixture, label: string): Promise<Seeded> {
  const integrationId = createId();
  const flowId = createId();
  const channelId = createId();
  const conversationId = createId();
  const runId = createId();
  const [agent1, agent2] = ws.agentIds as [string, string];
  const ids = new Set<string>();

  await sql`INSERT INTO workspace_integration (id, workspace_id, type, name, config_encrypted)
    VALUES (${integrationId}, ${ws.id}, 'mcp', ${`Data source ${label}`}, 'x')`;
  await sql`INSERT INTO flow (id, workspace_id, name) VALUES (${flowId}, ${ws.id}, ${`Nightly sync ${label}`})`;
  await sql`INSERT INTO channel (id, workspace_id, name, type, agent_id)
    VALUES (${channelId}, ${ws.id}, ${`Support desk ${label}`}, 'widget', ${agent1})`;

  await sql`INSERT INTO conversation (id, workspace_id, channel_id, agent_id, message_count,
      total_cost_usd, total_tokens, duration_seconds, started_at, created_at)
    VALUES (${conversationId}, ${ws.id}, ${channelId}, ${agent1}, 4, '0.015000', 1700, 90,
      ${t(0.5)}::timestamp, ${t(0.5)}::timestamp)`;
  ids.add(conversationId);

  const toolCall = async (
    at: string,
    fields: {
      source: string;
      tool: string;
      outcome: string;
      agentId?: string | null;
      channelId?: string | null;
      conversationId?: string | null;
      flowId?: string | null;
      flowRunId?: string | null;
      integrationType?: string | null;
      integrationId?: string | null;
      ref?: string | null;
      error?: string | null;
    }
  ) => {
    const id = createId();
    await sql`INSERT INTO tool_call (id, workspace_id, created_at, source, agent_id, conversation_id,
        channel_id, flow_id, flow_run_id, tool, integration_type, integration_id, ref, input,
        outcome, error, duration_ms, result_size)
      VALUES (${id}, ${ws.id}, ${at}::timestamptz, ${fields.source}, ${fields.agentId ?? null},
        ${fields.conversationId ?? null}, ${fields.channelId ?? null}, ${fields.flowId ?? null},
        ${fields.flowRunId ?? null}, ${fields.tool}, ${fields.integrationType ?? null},
        ${fields.integrationId ?? null}, ${fields.ref ?? null}, ${JSON.stringify({ q: "lookup" })}::jsonb,
        ${fields.outcome}, ${fields.error ?? null}, 30, 120)`;
    ids.add(id);
    return id;
  };

  const tc = {
    mcpOk: await toolCall(t(1), {
      source: "channel",
      tool: `mcp__${integrationId}__lookup`,
      outcome: "ok",
      agentId: agent1,
      channelId,
      conversationId,
      integrationType: "mcp",
      integrationId,
    }),
    // A hashed MCP tool name keeps only the first 20 characters of the id.
    mcpHashed: await toolCall(t(2), {
      source: "test_chat",
      tool: `mcp__${integrationId.slice(0, 20)}__a_long_remote_tool_name_0123456789abcdef`,
      outcome: "error",
      agentId: agent2,
      integrationType: "mcp",
      integrationId: integrationId.slice(0, 20),
      error: "remote failed",
    }),
    odooStep: await toolCall(t(3), {
      source: "flow_step",
      tool: "odoo::get_task",
      outcome: "ok",
      flowId,
      flowRunId: runId,
      integrationType: "odoo",
      ref: "odoo:4512",
    }),
    // Same instant as the step above: the id decides the order.
    odooRefused: await toolCall(t(3), {
      source: "api",
      tool: "odoo_update_task",
      outcome: "refused",
      agentId: agent1,
      integrationType: "odoo",
      ref: "odoo:77",
    }),
  };

  const usage = async (
    at: string,
    kind: string,
    cost: string,
    agentId: string | null,
    usageFlowId: string | null,
    metadata: Record<string, unknown>
  ) => {
    const id = createId();
    await sql`INSERT INTO usage_event (id, workspace_id, kind, amount, cost_usd, agent_id, flow_id,
        metadata, created_at)
      VALUES (${id}, ${ws.id}, ${kind}, 1, ${cost}, ${agentId}, ${usageFlowId},
        ${JSON.stringify(metadata)}::jsonb, ${at}::timestamp)`;
    ids.add(id);
    return id;
  };

  const ue = {
    // 500 µs after the tool call it paid for: same millisecond, later row.
    chat: await usage(t(1), "tokens_out", "0.012000", agent1, null, {
      model: "model-x",
      capability: "chat",
      tokensIn: 1000,
      tokensOut: 200,
      tokensTotal: 1200,
      cacheReadTokens: 300,
      conversationId,
    }),
    router: await usage(t(4), "agent_message", "0.003000", agent2, null, {
      tokens: 500,
      model: "model-y",
    }),
    routerLater: await usage(t(4, 1), "agent_message", "0.000000", agent2, null, {
      tokens: 0,
      model: "model-y",
      failed: true,
    }),
    flow: await usage(t(5), "tokens_out", "0.500000", null, flowId, {
      model: "model-x",
      capability: "chat",
      tokensIn: 10,
      tokensOut: 5,
      tokensTotal: 15,
      flowRunId: runId,
    }),
  };
  // Shift the chat usage row 500 µs past its millisecond.
  await sql`UPDATE usage_event SET created_at = ${t(1, 500)}::timestamp WHERE id = ${ue.chat}`;

  await sql`INSERT INTO flow_run (id, flow_id, workspace_id, status, trigger_source, error,
      started_at, completed_at)
    VALUES (${runId}, ${flowId}, ${ws.id}, 'failed', 'webhook', 'step failed',
      ${t(2.5)}::timestamp, ${t(6)}::timestamp)`;
  for (const [cost, tokens] of [
    ["0.250000", 100],
    ["0.250000", 50],
  ] as const) {
    await sql`INSERT INTO flow_run_step (id, run_id, node_id, node_type, status, cost_usd, tokens_used)
      VALUES (${createId()}, ${runId}, ${createId()}, 'agent', 'succeeded', ${cost}, ${tokens})`;
  }
  ids.add(runId);

  await appendAuditSync(ws.id, {
    action: "agent.update",
    actorUserId: ws.ownerId,
    actorKind: "user",
    targetType: "agent",
    targetId: agent1,
    meta: { field: "name" },
  });
  const [audit] = await sql<Array<{ id: string }>>`
    SELECT id FROM audit_log WHERE workspace_id = ${ws.id} ORDER BY seq DESC LIMIT 1`;
  ids.add(audit!.id);

  return {
    ids,
    integrationId,
    flowId,
    channelId,
    conversationId,
    runId,
    agent1,
    agent2,
    tc,
    ue,
    auditId: audit!.id,
  };
}

function range(extra: Partial<ActivityFilters> = {}): ActivityFilters {
  return {
    from: new Date(base - 3_600_000),
    to: new Date(Date.now() + 3_600_000),
    kinds: [...ACTIVITY_KINDS],
    ...extra,
  };
}

async function allRows(filters: ActivityFilters, limit: number): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];
  let cursor: { at: string; id: string } | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const page = await query.queryActivity(wsA.id, filters, { cursor, limit });
    expect(page.rows.length).toBeLessThanOrEqual(limit);
    rows.push(...page.rows);
    if (!page.nextCursor) return rows;
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not end");
}

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ sql } = await setupTestDb());
  query = await import("@/lib/activity/query");
  ({ appendAuditSync } = await import("@/lib/audit/log"));
  // Two days ago, on a whole second, so every seeded instant is in the past.
  base = Math.floor((Date.now() - 2 * 86_400_000) / 1000) * 1000;
  A = await seed(wsA, "A");
  B = await seed(wsB, "B");
  const rowsA = await sql<Array<{ id: string; at: string }>>`
    SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      FROM tool_call WHERE workspace_id = ${wsA.id}
    UNION ALL SELECT id, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM usage_event WHERE workspace_id = ${wsA.id}
    UNION ALL SELECT id, to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM flow_run WHERE workspace_id = ${wsA.id}
    UNION ALL SELECT id, to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM conversation WHERE workspace_id = ${wsA.id}
    UNION ALL SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM audit_log WHERE workspace_id = ${wsA.id}`;
  expectedA = [...rowsA].map((r) => ({ at: r.at, id: r.id })).sort(compareActivityDesc);
});
afterAll(() => teardownTestWorkspaces());

describe("queryActivity", () => {
  it("returns every source of the caller's workspace, newest first, and nothing of the other", async () => {
    const { rows, nextCursor } = await query.queryActivity(wsA.id, range(), {
      cursor: null,
      limit: 100,
    });
    expect(nextCursor).toBeNull();
    expect(rows.map((r) => r.id)).toEqual(expectedA.map((r) => r.id));
    expect(rows).toHaveLength(A.ids.size);
    for (const row of rows) {
      expect(A.ids.has(row.id), `${row.kind} ${row.id}`).toBe(true);
      expect(B.ids.has(row.id)).toBe(false);
    }
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(ACTIVITY_KINDS));
  });

  it("keeps microsecond order: a usage row 500 µs after a tool call comes first", async () => {
    const { rows } = await query.queryActivity(wsA.id, range(), { cursor: null, limit: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(A.ue.chat)).toBeLessThan(ids.indexOf(A.tc.mcpOk));
    const chat = rows.find((r) => r.id === A.ue.chat)!;
    expect(chat.at.endsWith("500Z")).toBe(true);
  });

  it.each([1, 2, 3, 4, 7])("walks every row once with pages of %i", async (limit) => {
    const rows = await allRows(range(), limit);
    expect(rows.map((r) => r.id)).toEqual(expectedA.map((r) => r.id));
  });

  it("resolves names and builds the common row of each kind", async () => {
    const { rows } = await query.queryActivity(wsA.id, range(), { cursor: null, limit: 100 });
    const byId = new Map(rows.map((r) => [r.id, r]));

    const mcp = byId.get(A.tc.mcpOk)!;
    expect(mcp).toMatchObject({
      kind: "tool_call",
      agent: { id: A.agent1, name: "Agent 1" },
      channel: { id: A.channelId, name: "Support desk A" },
      integration: { type: "mcp", id: A.integrationId, name: "Data source A" },
      outcome: "ok",
      durationMs: 30,
      link: `/conversations/${A.conversationId}`,
      detail: { kind: "tool_call", input: { q: "lookup" }, source: "channel", resultSize: 120 },
    });

    // The hashed name's 20-character key resolves to the same integration.
    expect(byId.get(A.tc.mcpHashed)).toMatchObject({
      integration: { type: "mcp", id: A.integrationId, name: "Data source A" },
      outcome: "error",
      detail: { error: "remote failed" },
      link: `/agents/${A.agent2}`,
    });

    expect(byId.get(A.ue.chat)).toMatchObject({
      kind: "model_usage",
      agent: { id: A.agent1, name: "Agent 1" },
      tokens: { in: 1000, out: 200, cacheWrite: null, cacheRead: 300, total: 1200 },
      costUsd: 0.012,
      link: `/conversations/${A.conversationId}`,
      detail: { model: "model-x", capability: "chat", failed: false },
    });
    expect(byId.get(A.ue.router)).toMatchObject({
      tokens: { in: null, out: null, total: 500 },
      costUsd: 0.003,
      detail: { usageKind: "agent_message", model: "model-y" },
    });
    expect(byId.get(A.ue.routerLater)).toMatchObject({ detail: { failed: true } });

    expect(byId.get(A.runId)).toMatchObject({
      kind: "flow_run",
      flow: { id: A.flowId, name: "Nightly sync A" },
      outcome: "error",
      costUsd: 0.5,
      tokens: { total: 150 },
      durationMs: 3500,
      link: `/flows/${A.flowId}`,
      detail: { status: "failed", triggerSource: "webhook", error: "step failed", steps: 2 },
    });

    expect(byId.get(A.conversationId)).toMatchObject({
      kind: "conversation",
      agent: { id: A.agent1, name: "Agent 1" },
      channel: { id: A.channelId, name: "Support desk A" },
      costUsd: 0.015,
      tokens: { total: 1700 },
      durationMs: 90_000,
      detail: { status: "open", messageCount: 4 },
    });

    expect(byId.get(A.auditId)).toMatchObject({
      kind: "config_change",
      agent: { id: A.agent1, name: "Agent 1" },
      link: "/settings#audit",
      detail: {
        action: "agent.update",
        actor: { kind: "user", userId: wsA.ownerId },
        targetType: "agent",
        targetId: A.agent1,
      },
    });
  });

  it("filters MCP calls by integration type, with the integration named", async () => {
    const { rows } = await query.queryActivity(wsA.id, range({ integrationType: "mcp" }), {
      cursor: null,
      limit: 100,
    });
    expect(rows.map((r) => r.id)).toEqual([A.tc.mcpHashed, A.tc.mcpOk]);
  });

  it("filters by integration id, matching the hashed key too", async () => {
    const { rows } = await query.queryActivity(wsA.id, range({ integrationId: A.integrationId }), {
      cursor: null,
      limit: 100,
    });
    expect(rows.map((r) => r.id)).toEqual([A.tc.mcpHashed, A.tc.mcpOk]);
  });

  it("filters by ref prefix, on tool calls only", async () => {
    const all = await query.queryActivity(wsA.id, range({ ref: "odoo:" }), {
      cursor: null,
      limit: 100,
    });
    expect(new Set(all.rows.map((r) => r.id))).toEqual(new Set([A.tc.odooStep, A.tc.odooRefused]));
    const one = await query.queryActivity(wsA.id, range({ ref: "odoo:4512" }), {
      cursor: null,
      limit: 100,
    });
    expect(one.rows.map((r) => r.id)).toEqual([A.tc.odooStep]);
  });

  it("filters by agent across tool calls, usage, conversations and changes to the agent", async () => {
    const { rows } = await query.queryActivity(wsA.id, range({ agentId: A.agent1 }), {
      cursor: null,
      limit: 100,
    });
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set([A.tc.mcpOk, A.tc.odooRefused, A.ue.chat, A.conversationId, A.auditId])
    );
  });

  it("filters by flow and by outcome", async () => {
    const flow = await query.queryActivity(wsA.id, range({ flowId: A.flowId }), {
      cursor: null,
      limit: 100,
    });
    expect(new Set(flow.rows.map((r) => r.id))).toEqual(
      new Set([A.tc.odooStep, A.ue.flow, A.runId])
    );
    const failed = await query.queryActivity(wsA.id, range({ outcome: "error" }), {
      cursor: null,
      limit: 100,
    });
    expect(new Set(failed.rows.map((r) => r.id))).toEqual(new Set([A.tc.mcpHashed, A.runId]));
  });

  it("returns nothing for another workspace's ids", async () => {
    const { rows } = await query.queryActivity(wsA.id, range({ agentId: B.agent1 }), {
      cursor: null,
      limit: 100,
    });
    expect(rows).toEqual([]);
  });

  it("returns nothing outside the range", async () => {
    const { rows } = await query.queryActivity(
      wsA.id,
      range({ from: new Date(base - 7_200_000), to: new Date(base - 3_600_000) }),
      { cursor: null, limit: 100 }
    );
    expect(rows).toEqual([]);
  });
});

describe("activityTotals", () => {
  it("counts tool calls by tool, agent and integration and spend by agent and flow", async () => {
    const totals = await query.activityTotals(wsA.id, range());
    expect(totals.counts).toEqual({
      tool_call: 4,
      model_usage: 4,
      flow_run: 1,
      conversation: 1,
      config_change: 1,
    });
    expect(totals.toolCalls).toEqual({ total: 4, ok: 2, error: 1, refused: 1 });
    expect(totals.toolCallsByTool).toHaveLength(4);
    expect(totals.toolCallsByIntegration).toEqual([
      {
        integration: { type: "mcp", id: A.integrationId, name: "Data source A" },
        total: 2,
        ok: 1,
        error: 1,
        refused: 0,
      },
      {
        integration: { type: "odoo", id: null, name: null },
        total: 2,
        ok: 1,
        error: 0,
        refused: 1,
      },
    ]);
    expect(totals.toolCallsByAgent).toEqual(
      [
        { agent: null, total: 1, ok: 1, error: 0, refused: 0 },
        { agent: { id: A.agent1, name: "Agent 1" }, total: 2, ok: 1, error: 0, refused: 1 },
        { agent: { id: A.agent2, name: "Agent 2" }, total: 1, ok: 0, error: 1, refused: 0 },
      ].sort((a, b) => b.total - a.total || (a.agent?.id ?? "").localeCompare(b.agent?.id ?? ""))
    );

    expect(totals.usage).toEqual({
      events: 4,
      costUsd: 0.515,
      tokens: { in: 1010, out: 205, cacheWrite: 0, cacheRead: 300, total: 1715 },
    });
    expect(totals.usageByAgent.map((u) => [u.agent?.name ?? null, u.costUsd, u.events])).toEqual([
      [null, 0.5, 1],
      ["Agent 1", 0.012, 1],
      ["Agent 2", 0.003, 2],
    ]);
    expect(totals.usageByFlow.map((u) => [u.flow?.name ?? null, u.costUsd])).toEqual([
      ["Nightly sync A", 0.5],
      [null, 0.015],
    ]);
  });

  it("keeps to the filters: MCP calls only, no spend", async () => {
    const totals = await query.activityTotals(wsA.id, range({ integrationType: "mcp" }));
    expect(totals.counts).toEqual({
      tool_call: 2,
      model_usage: 0,
      flow_run: 0,
      conversation: 0,
      config_change: 0,
    });
    expect(totals.toolCalls).toEqual({ total: 2, ok: 1, error: 1, refused: 0 });
    expect(totals.toolCallsByAgent.map((a) => a.agent?.id)).toEqual(
      [A.agent1, A.agent2].sort((x, y) => (x < y ? -1 : 1))
    );
    expect(totals.usage.events).toBe(0);
    expect(totals.usageByAgent).toEqual([]);
  });
});

describe("GET /api/workspaces/[slug]/activity", () => {
  const url = (slug: string, params: Record<string, string>) => {
    const u = new URL(`https://app.test/api/workspaces/${slug}/activity`);
    const f = range();
    u.searchParams.set("from", f.from.toISOString());
    u.searchParams.set("to", f.to.toISOString());
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };
  const call = async (slug: string, params: Record<string, string> = {}) => {
    const { GET } = await import("@/app/api/workspaces/[slug]/activity/route");
    return GET(new Request(url(slug, params)), { params: Promise.resolve({ slug }) });
  };

  it("returns the caller's rows, totals on the first page and a cursor that continues", async () => {
    auth.userId = wsA.ownerId;
    const first = await call(wsA.slug, { limit: "4" });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.rows.map((r: ActivityRow) => r.id)).toEqual(expectedA.slice(0, 4).map((r) => r.id));
    expect(body.totals.counts.tool_call).toBe(4);
    expect(typeof body.nextCursor).toBe("string");

    const second = await call(wsA.slug, { limit: "100", cursor: body.nextCursor });
    const next = await second.json();
    expect(next.totals).toBeNull();
    expect(next.rows.map((r: ActivityRow) => r.id)).toEqual(expectedA.slice(4).map((r) => r.id));
    expect(next.nextCursor).toBeNull();
  });

  it("refuses a viewer of the workspace and a member of another one", async () => {
    const viewer = createId();
    await sql`INSERT INTO "user" (id, email, name, email_verified)
      VALUES (${viewer}, ${`${viewer}@test.local`}, 'Viewer', true)`;
    await sql`INSERT INTO workspace_member (id, workspace_id, user_id, role)
      VALUES (${createId()}, ${wsA.id}, ${viewer}, 'viewer')`;
    auth.userId = viewer;
    expect((await call(wsA.slug)).status).toBe(403);

    auth.userId = wsB.ownerId;
    const res = await call(wsA.slug);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_a_member" });
  });

  it("rejects a range over 92 days", async () => {
    auth.userId = wsA.ownerId;
    const res = await call(wsA.slug, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "range_too_long", field: "to" });
  });
});

describe("GET /api/workspaces/[slug]/activity/export", () => {
  it("returns the caller's rows as CSV and records the export in the caller's audit log", async () => {
    auth.userId = wsA.ownerId;
    const f = range({ kinds: ["tool_call", "flow_run"] });
    const u = new URL(`https://app.test/api/workspaces/${wsA.slug}/activity/export`);
    u.searchParams.set("from", f.from.toISOString());
    u.searchParams.set("to", f.to.toISOString());
    u.searchParams.set("kinds", "tool_call,flow_run");
    const { GET } = await import("@/app/api/workspaces/[slug]/activity/export/route");
    const res = await GET(new Request(u.toString()), {
      params: Promise.resolve({ slug: wsA.slug }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="activity-/);
    const csv = await res.text();
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(1 + 5); // header + 4 tool calls + 1 run
    for (const id of [A.tc.mcpOk, A.tc.mcpHashed, A.tc.odooStep, A.tc.odooRefused, A.runId]) {
      expect(csv).toContain(id);
    }
    for (const id of B.ids) expect(csv).not.toContain(id);

    const entries = await sql<
      Array<{ workspace_id: string; actor_user_id: string; meta: Record<string, unknown> }>
    >`SELECT workspace_id, actor_user_id, meta FROM audit_log WHERE action = 'activity.export'`;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      workspace_id: wsA.id,
      actor_user_id: wsA.ownerId,
      meta: {
        rows: 5,
        truncated: false,
        filters: {
          from: f.from.toISOString(),
          to: f.to.toISOString(),
          kinds: ["tool_call", "flow_run"],
        },
      },
    });
  });
});
