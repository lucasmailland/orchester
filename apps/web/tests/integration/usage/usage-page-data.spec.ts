// apps/web/tests/integration/usage/usage-page-data.spec.ts
//
// COST-10 — the real Usage page data function (`getUsagePageData`) must sum
// the authoritative `usage_event` rows (cost_usd + token amounts + per-agent
// conversation counts), not estimates. We seed a known set of usage_event
// rows across two days for one workspace, call the real function, and assert
// the returned totals/series equal the seeded sums exactly. A second
// workspace is seeded with its own usage so we also prove tenant isolation:
// another workspace's rows must NOT leak into the caller's totals.
import { it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let wsB: WsFixture;
let getUsagePageData: typeof import("@/lib/usage/data").getUsagePageData;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

// Two distinct days inside the 30-day window that `getUsagePageData` scans.
const dayOne = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const dayTwo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ getUsagePageData } = await import("@/lib/usage/data"));
  ({ getDb, schema } = await import("@orchester/db"));

  const db = getDb();
  const agentA0 = wsA.agentIds[0]!;
  const agentA1 = wsA.agentIds[1]!;

  // --- Workspace A usage_event rows (the ones we assert on) ---------------
  // agentA0: dayOne  tokens_in=1000 (cost 0.10) + tokens_out=500 (cost 0.20)
  //          dayTwo  tokens_in=2000 (cost 0.30)
  //          plus a non-token kind (agent_message) with cost 0.05 that must
  //          count toward cost but NOT toward token totals.
  // agentA1: dayTwo  tokens_out=750 (cost 0.15)
  await db.insert(schema.usageEvents).values([
    {
      id: createId(),
      workspaceId: wsA.id,
      agentId: agentA0,
      kind: "tokens_in",
      amount: 1000,
      costUsd: "0.100000",
      createdAt: dayOne,
    },
    {
      id: createId(),
      workspaceId: wsA.id,
      agentId: agentA0,
      kind: "tokens_out",
      amount: 500,
      costUsd: "0.200000",
      createdAt: dayOne,
    },
    {
      id: createId(),
      workspaceId: wsA.id,
      agentId: agentA0,
      kind: "tokens_in",
      amount: 2000,
      costUsd: "0.300000",
      createdAt: dayTwo,
    },
    {
      id: createId(),
      workspaceId: wsA.id,
      agentId: agentA0,
      kind: "agent_message",
      amount: 1,
      costUsd: "0.050000",
      createdAt: dayTwo,
    },
    {
      id: createId(),
      workspaceId: wsA.id,
      agentId: agentA1,
      kind: "tokens_out",
      amount: 750,
      costUsd: "0.150000",
      createdAt: dayTwo,
    },
  ]);

  // --- Workspace B usage_event rows (isolation guard) --------------------
  // Large, distinctive amounts so any leak into wsA's totals is obvious.
  await db.insert(schema.usageEvents).values([
    {
      id: createId(),
      workspaceId: wsB.id,
      agentId: wsB.agentIds[0]!,
      kind: "tokens_in",
      amount: 999_999,
      costUsd: "99.000000",
      createdAt: dayTwo,
    },
    {
      id: createId(),
      workspaceId: wsB.id,
      agentId: wsB.agentIds[0]!,
      kind: "tokens_out",
      amount: 888_888,
      costUsd: "88.000000",
      createdAt: dayTwo,
    },
  ]);
}, 60_000);

afterAll(() => teardownTestWorkspaces());

it("sums usage_event token amounts and cost per agent (exact, not estimated)", async () => {
  const data = await getUsagePageData(wsA.id);

  // agentA0 token amount = 1000 + 500 + 2000 = 3500 (agent_message excluded)
  // agentA1 token amount = 750
  const a0 = data.agentUsage.find((a) => a.id === wsA.agentIds[0]);
  const a1 = data.agentUsage.find((a) => a.id === wsA.agentIds[1]);
  expect(a0).toBeTruthy();
  expect(a1).toBeTruthy();
  expect(a0!.tokens).toBe(3500);
  expect(a1!.tokens).toBe(750);

  // cost sums ALL kinds for the agent: agentA0 = 0.10+0.20+0.30+0.05 = 0.65
  //                                    agentA1 = 0.15
  expect(a0!.costUsd).toBeCloseTo(0.65, 6);
  expect(a1!.costUsd).toBeCloseTo(0.15, 6);

  // The third fixture agent had no usage and is filtered out of agentUsage.
  expect(data.agentUsage).toHaveLength(2);
});

it("returns totals equal to the seeded sums", async () => {
  const data = await getUsagePageData(wsA.id);

  // totalTokens = sum of agentUsage token amounts = 3500 + 750 = 4250
  expect(data.totalTokens).toBe(4250);
  // totalCostUsd = 0.65 + 0.15 = 0.80
  expect(data.totalCostUsd).toBeCloseTo(0.8, 6);
});

it("buckets token amounts by day for the last-30-days series", async () => {
  const data = await getUsagePageData(wsA.id);

  const byDay = new Map(data.tokensByDay.map((r) => [r.date, r.tokens]));
  // dayOne token amount = 1000 (in) + 500 (out) = 1500
  // dayTwo token amount = 2000 (in) + 750 (out) = 2750   (agent_message excluded)
  expect(byDay.get(isoDay(dayOne))).toBe(1500);
  expect(byDay.get(isoDay(dayTwo))).toBe(2750);
  // Series total matches the grand token total.
  const seriesTotal = data.tokensByDay.reduce((s, r) => s + r.tokens, 0);
  expect(seriesTotal).toBe(4250);
});

it("isolates usage by workspace — another workspace's rows never leak in", async () => {
  const data = await getUsagePageData(wsA.id);

  // wsB seeded 999_999 + 888_888 tokens and $187 of cost. None may appear.
  expect(data.totalTokens).toBe(4250);
  expect(data.totalCostUsd).toBeLessThan(1);
  expect(data.agentUsage.every((a) => wsA.agentIds.includes(a.id))).toBe(true);

  // And wsB, queried on its own, sees only its own usage (not wsA's).
  const dataB = await getUsagePageData(wsB.id);
  expect(dataB.totalTokens).toBe(999_999 + 888_888);
  expect(dataB.agentUsage.every((a) => wsB.agentIds.includes(a.id))).toBe(true);
});
