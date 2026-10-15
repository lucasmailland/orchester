// apps/web/tests/integration/dashboard/command-center.spec.ts
//
// The Command Center numbers against a real Postgres (testcontainer). Model
// spend comes from `usage_event` only, in both shapes it is written (the
// channel router's `agent_message` rows and `recordAiUsage`'s `tokens_out`
// rows, old metadata shapes included); the router also stamps
// `message.tokens_used` for the same turn, which must not be counted again.
// A second workspace holds rows at the same instants, some pointing at the
// first workspace's agent, and none of them may show up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The global vitest.setup.ts stubs out @orchester/db; integration tests need
// the real module, imported dynamically once the container is up.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { createId } from "@paralleldrive/cuid2";
import { setupTestDb } from "../../fixtures/db";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import type { FullDashboardStats } from "@/lib/db-queries";

type Sql = Awaited<ReturnType<typeof setupTestDb>>["sql"];

let sql: Sql;
let wsA: WsFixture;
let wsB: WsFixture;
let queries: typeof import("@/lib/db-queries");
let withWorkspaceTx: typeof import("@/lib/tenant/context").withWorkspaceTx;

/** The reading instant: every window is computed from it, not from the clock. */
const NOW = new Date("2026-03-20T12:00:00.000Z");

interface SeededA {
  team1: string;
  team2: string;
  flow1: string;
  flow2: string;
}
let A: SeededA;

async function usage(
  ws: string,
  at: string,
  kind: string,
  cost: string,
  agentId: string | null,
  flowId: string | null,
  metadata: Record<string, unknown>
) {
  await sql`INSERT INTO usage_event (id, workspace_id, kind, amount, cost_usd, agent_id, flow_id,
      metadata, created_at)
    VALUES (${createId()}, ${ws}, ${kind}, 1, ${cost}, ${agentId}, ${flowId},
      ${JSON.stringify(metadata)}::jsonb, ${at}::timestamp)`;
}

async function conversation(ws: string, agentId: string | null, startedAt: string) {
  const id = createId();
  await sql`INSERT INTO conversation (id, workspace_id, agent_id, started_at, created_at)
    VALUES (${id}, ${ws}, ${agentId}, ${startedAt}::timestamp, ${startedAt}::timestamp)`;
  return id;
}

async function message(conversationId: string, at: string, role: string, tokens: number | null) {
  await sql`INSERT INTO message (id, conversation_id, role, content, tokens_used, created_at)
    VALUES (${createId()}, ${conversationId}, ${role}, 'text', ${tokens}, ${at}::timestamp)`;
}

async function flow(ws: string, name: string) {
  const id = createId();
  await sql`INSERT INTO flow (id, workspace_id, name) VALUES (${id}, ${ws}, ${name})`;
  return id;
}

async function flowRun(ws: string, flowId: string, startedAt: string, status = "succeeded") {
  await sql`INSERT INTO flow_run (id, flow_id, workspace_id, status, started_at)
    VALUES (${createId()}, ${flowId}, ${ws}, ${status}, ${startedAt}::timestamp)`;
}

async function team(ws: string, name: string, agentIds: string[]) {
  const id = createId();
  await sql`INSERT INTO team (id, workspace_id, name, avatar_color) VALUES (${id}, ${ws}, ${name}, '#123456')`;
  for (const agentId of agentIds) {
    await sql`UPDATE agent SET team_id = ${id} WHERE id = ${agentId}`;
  }
  return id;
}

async function seedA(ws: WsFixture): Promise<SeededA> {
  const [a1, a2, a3] = ws.agentIds as [string, string, string];
  const team1 = await team(ws.id, "Front desk", [a1]);
  const team2 = await team(ws.id, "Back office", [a2]);
  const flow1 = await flow(ws.id, "Nightly sync");
  const flow2 = await flow(ws.id, "Image batch");

  // Conversations: three this month, two last month (one of them outside
  // the 30-day window, which starts 2026-02-18T12:00).
  const c1 = await conversation(ws.id, a1, "2026-03-10T10:00:00");
  await message(c1, "2026-03-10T10:00:05", "user", null);
  // The router stamps the turn's tokens on the message AND writes a usage row.
  await message(c1, "2026-03-10T10:02:00", "assistant", 500);
  await message(c1, "2026-03-10T10:05:00", "user", null);
  const c2 = await conversation(ws.id, a2, "2026-03-12T09:00:00");
  await message(c2, "2026-03-12T09:00:10", "user", null);
  await message(c2, "2026-03-12T09:01:40", "assistant", 700);
  const c3 = await conversation(ws.id, a1, "2026-03-15T08:00:00");
  await message(c3, "2026-03-15T08:00:03", "user", null);
  const c4 = await conversation(ws.id, a1, "2026-02-25T10:00:00");
  await message(c4, "2026-02-25T10:00:30", "user", null);
  await message(c4, "2026-02-25T10:20:00", "assistant", 1000);
  const c5 = await conversation(ws.id, a2, "2026-02-05T10:00:00");
  await message(c5, "2026-02-05T10:00:01", "user", null);
  await message(c5, "2026-02-05T12:46:40", "assistant", 10);

  // This month.
  // Router turns: `agent_message`, metadata { tokens, model }.
  await usage(ws.id, "2026-03-10T10:02:00", "agent_message", "0.010000", a1, null, {
    tokens: 500,
    model: "model-a",
  });
  await usage(ws.id, "2026-03-10T10:04:00", "agent_message", "0.001000", a1, null, {
    tokens: 50,
    model: "model-a",
    failed: true,
  });
  await usage(ws.id, "2026-03-12T09:01:40", "agent_message", "0.020000", a2, null, {
    tokens: 700,
    model: "model-a",
  });
  // recordAiUsage: an agent step of a flow run (agent and flow).
  await usage(ws.id, "2026-03-11T08:00:00", "tokens_out", "0.050000", a1, flow1, {
    model: "model-b",
    capability: "chat",
    tokensIn: 1000,
    tokensOut: 200,
    tokensTotal: 1200,
    cacheReadTokens: 300,
    flowRunId: "run-1",
    nodeId: "node-1",
  });
  // An llm_prompt step: flow, no agent.
  await usage(ws.id, "2026-03-11T08:00:05", "tokens_out", "0.030000", null, flow1, {
    model: "model-b",
    capability: "chat",
    tokensIn: 300,
    tokensOut: 100,
    tokensTotal: 400,
    flowRunId: "run-1",
    nodeId: "node-2",
  });
  // An image step: flow, no agent, no tokens.
  await usage(ws.id, "2026-03-16T10:00:00", "flow_run", "0.040000", null, flow2, {
    model: "model-img",
    capability: "image",
    units: 1,
  });
  // The agent API inside a conversation, without tokensTotal.
  await usage(ws.id, "2026-03-12T09:01:00", "tokens_out", "0.003000", a2, null, {
    model: "model-b",
    capability: "chat",
    tokensIn: 40,
    tokensOut: 60,
    conversationId: c2,
  });
  // Old shapes: `tokens` alone (test chat) and `tokensOut` alone (no attribution).
  await usage(ws.id, "2026-03-14T15:00:00", "tokens_out", "0.004000", a3, null, { tokens: 90 });
  await usage(ws.id, "2026-03-13T00:00:00", "tokens_out", "0.002000", null, null, {
    tokensOut: 80,
  });
  // An agent that no longer exists, on the first instant of the month.
  await usage(ws.id, "2026-03-01T00:00:00", "tokens_out", "0.001000", createId(), null, {
    tokensTotal: 25,
  });

  // Last month, both ends included; the one before is out.
  await usage(ws.id, "2026-02-01T00:00:00", "tokens_out", "0.007000", a3, null, {
    tokensTotal: 7,
  });
  await usage(ws.id, "2026-02-26T10:00:00", "agent_message", "0.100000", a1, null, {
    tokens: 1000,
    model: "model-a",
  });
  await usage(ws.id, "2026-02-28T23:59:59.999", "tokens_out", "0.050000", null, flow1, {
    tokensTotal: 500,
  });
  await usage(ws.id, "2026-01-31T12:00:00", "agent_message", "9.990000", a1, null, {
    tokens: 99_999,
  });

  await flowRun(ws.id, flow1, "2026-03-11T07:59:00");
  await flowRun(ws.id, flow1, "2026-03-14T07:59:00", "failed");
  await flowRun(ws.id, flow2, "2026-03-16T09:59:00");
  await flowRun(ws.id, flow1, "2026-02-20T07:59:00");
  await flowRun(ws.id, flow1, "2026-01-20T07:59:00");

  return { team1, team2, flow1, flow2 };
}

/** Big numbers at the same instants: any of them leaking would show. */
async function seedB(ws: WsFixture, agentOfA: string) {
  const [b1] = ws.agentIds as [string];
  await team(ws.id, "Other desk", [b1]);
  const flowB = await flow(ws.id, "Other flow");
  const cb1 = await conversation(ws.id, b1, "2026-03-10T10:00:00");
  await message(cb1, "2026-03-10T10:00:00", "user", null);
  await message(cb1, "2026-03-11T00:00:00", "assistant", 5_000_000);
  // Rows that name the other workspace's agent: still workspace B's.
  const cb2 = await conversation(ws.id, agentOfA, "2026-03-11T10:00:00");
  await message(cb2, "2026-03-11T10:00:00", "user", null);
  await message(cb2, "2026-03-12T10:00:00", "assistant", 6_000_000);
  await usage(ws.id, "2026-03-10T10:02:00", "agent_message", "100.000000", b1, null, {
    tokens: 1_000_000,
  });
  await usage(ws.id, "2026-03-11T08:00:00", "tokens_out", "200.000000", agentOfA, null, {
    tokensTotal: 2_000_000,
  });
  await usage(ws.id, "2026-03-11T08:00:05", "tokens_out", "300.000000", null, flowB, {
    tokensTotal: 3_000_000,
  });
  await usage(ws.id, "2026-02-26T10:00:00", "agent_message", "400.000000", b1, null, {
    tokens: 4_000_000,
  });
  await flowRun(ws.id, flowB, "2026-03-11T07:59:00");
  await flowRun(ws.id, flowB, "2026-03-12T07:59:00");
  await flowRun(ws.id, flowB, "2026-02-20T07:59:00");
}

/** The page's path: a workspace transaction as `app_user`, under RLS. */
function readInWorkspace(wsId: string): Promise<FullDashboardStats> {
  return withWorkspaceTx(wsId, (tx) => queries.getFullDashboardStats(wsId, tx, { now: NOW }));
}

let stats: FullDashboardStats;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ sql } = await setupTestDb());
  queries = await import("@/lib/db-queries");
  ({ withWorkspaceTx } = await import("@/lib/tenant/context"));
  A = await seedA(wsA);
  await seedB(wsB, wsA.agentIds[0]!);
  stats = await readInWorkspace(wsA.id);
});
afterAll(() => teardownTestWorkspaces());

describe("getFullDashboardStats — model spend", () => {
  it("stamps the instant the numbers were read", () => {
    expect(stats.generatedAt).toBe(NOW.toISOString());
  });

  it("counts tokens and cost of every model call this month from usage_event, once", () => {
    // 500 + 50 + 700 + 1200 + 400 + 0 + 100 + 90 + 80 + 25: never the
    // message.tokens_used of the same router turns (500, 700).
    expect(stats.totalTokensMonth).toBe(3145);
    expect(stats.totalCostMonth).toBeCloseTo(0.161, 6);
  });

  it("compares with the whole of last month, both ends included", () => {
    expect(stats.totalTokensLastMonth).toBe(1507);
    expect(stats.totalCostLastMonth).toBeCloseTo(0.157, 6);
  });

  it("keeps conversation counts on the conversation table", () => {
    expect(stats.conversationsMonth).toBe(3);
    expect(stats.conversationsLastMonth).toBe(2);
  });

  it("divides only conversation spend by conversations", () => {
    // Router turns (500 + 50 + 700) and the call that names a conversation
    // (100): 1350 tokens, $0.034, over 3 conversations.
    expect(stats.avgTokensPerConv).toBe(450);
    expect(stats.avgCostPerConv).toBeCloseTo(0.034 / 3, 6);
  });

  it("breaks spend down by agent, flow steps without an agent, and the rest", () => {
    const [a1, a2, a3] = wsA.agentIds as [string, string, string];
    expect(stats.agentUsage).toEqual([
      expect.objectContaining({
        id: a1,
        name: "Agent 1",
        conversations: 2,
        tokens: 1750,
        tokensPerConv: 275,
      }),
      expect.objectContaining({
        id: a2,
        name: "Agent 2",
        conversations: 1,
        tokens: 800,
        tokensPerConv: 800,
      }),
      expect.objectContaining({
        id: a3,
        name: "Agent 3",
        conversations: 0,
        tokens: 90,
        tokensPerConv: 0,
      }),
    ]);
    expect(stats.agentUsage.map((a) => a.costUsd)).toEqual([
      expect.closeTo(0.061, 6),
      expect.closeTo(0.023, 6),
      expect.closeTo(0.004, 6),
    ]);
    expect(stats.flowStepUsage.tokens).toBe(400);
    expect(stats.flowStepUsage.costUsd).toBeCloseTo(0.07, 6);
    // No agent and no flow, or an agent that is gone.
    expect(stats.otherUsage.tokens).toBe(105);
    expect(stats.otherUsage.costUsd).toBeCloseTo(0.003, 6);
    // The parts add up to the totals.
    const parts = [...stats.agentUsage, stats.flowStepUsage, stats.otherUsage];
    expect(parts.reduce((s, p) => s + p.tokens, 0)).toBe(stats.totalTokensMonth);
    expect(parts.reduce((s, p) => s + p.costUsd, 0)).toBeCloseTo(stats.totalCostMonth, 6);
  });

  it("counts this month's flow runs and the model cost of every call made for a flow", () => {
    expect(stats.flowRunsMonth).toBe(3);
    expect(stats.flowRunsLastMonth).toBe(1);
    // The agent step (0.05), the llm_prompt step (0.03) and the image (0.04).
    expect(stats.flowCostMonth).toBeCloseTo(0.12, 6);
    expect(stats.flowTokensMonth).toBe(1600);
  });

  it("reads team spend from usage_event over the last 30 days", () => {
    expect(stats.teamStats).toEqual([
      expect.objectContaining({ teamId: A.team1, teamName: "Front desk", conversations: 3 }),
      expect.objectContaining({ teamId: A.team2, teamName: "Back office", conversations: 1 }),
    ]);
    // Agent 1: 500 + 50 + 1200 this month and 1000 on Feb 26.
    expect(stats.teamStats[0]!.tokens).toBe(2750);
    expect(stats.teamStats[0]!.costUsd).toBeCloseTo(0.161, 6);
    expect(stats.teamStats[1]!.tokens).toBe(800);
    expect(stats.teamStats[1]!.costUsd).toBeCloseTo(0.023, 6);
  });

  it("charts tokens by day from usage_event over the last 30 days", () => {
    expect(stats.activityByDay).toEqual([
      { date: "2026-02-25", conversations: 1, tokens: 0 },
      { date: "2026-02-26", conversations: 0, tokens: 1000 },
      { date: "2026-02-28", conversations: 0, tokens: 500 },
      { date: "2026-03-01", conversations: 0, tokens: 25 },
      { date: "2026-03-10", conversations: 1, tokens: 550 },
      { date: "2026-03-11", conversations: 0, tokens: 1600 },
      { date: "2026-03-12", conversations: 1, tokens: 800 },
      { date: "2026-03-13", conversations: 0, tokens: 80 },
      { date: "2026-03-14", conversations: 0, tokens: 90 },
      { date: "2026-03-15", conversations: 1, tokens: 0 },
      { date: "2026-03-16", conversations: 0, tokens: 0 },
    ]);
  });
});

describe("getFullDashboardStats — average duration", () => {
  it("averages last message minus start over the last 30 days, two messages or more", () => {
    // 300 s, 100 s and 1200 s. The one-message conversation and the one
    // started before the window stay out; nothing writes duration_seconds.
    expect(stats.avgDurationSeconds).toBe(533);
  });
});

describe("getFullDashboardStats — isolation", () => {
  it("reads the same numbers without RLS: each query filters by workspace itself", async () => {
    // A bare connection as the container's superuser bypasses RLS, so only
    // the explicit workspace filters keep workspace B out.
    const bare = await queries.getFullDashboardStats(wsA.id, undefined, { now: NOW });
    expect(bare).toEqual(stats);
  });

  it("gives the other workspace its own numbers, with the foreign agent as other spend", async () => {
    const b = await readInWorkspace(wsB.id);
    expect(b.totalTokensMonth).toBe(6_000_000);
    expect(b.totalCostMonth).toBeCloseTo(600, 6);
    expect(b.totalTokensLastMonth).toBe(4_000_000);
    expect(b.conversationsMonth).toBe(2);
    expect(b.flowRunsMonth).toBe(2);
    expect(b.flowRunsLastMonth).toBe(1);
    expect(b.flowCostMonth).toBeCloseTo(300, 6);
    expect(b.agentUsage.map((a) => a.id)).toEqual([wsB.agentIds[0]]);
    expect(b.otherUsage.tokens).toBe(2_000_000);
    expect(b.flowStepUsage.tokens).toBe(3_000_000);
    const bare = await queries.getFullDashboardStats(wsB.id, undefined, { now: NOW });
    expect(bare).toEqual(b);
  });
});
