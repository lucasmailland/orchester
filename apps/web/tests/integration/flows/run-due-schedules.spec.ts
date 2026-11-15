// apps/web/tests/integration/flows/run-due-schedules.spec.ts
//
// ORCH-2 — the worker poller that runs due flow schedules. Verifies a
// due `flow_schedule` row gets a fresh `flow_run` enqueued and its
// nextRunAt advanced; a not-yet-due row is left untouched.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

// The poller enqueues JOB_FLOW_RUN via lib/queue; we don't want a real
// pg-boss here, so stub enqueue and assert it was called.
const enqueueCalls: Array<{ name: string; data: unknown }> = [];
vi.mock("@/lib/queue", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    enqueue: vi.fn(async (name: string, data: unknown) => {
      enqueueCalls.push({ name, data });
      return "job-id";
    }),
  };
});

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let runDueSchedules: typeof import("@/lib/flows/run-due-schedules").runDueSchedules;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ runDueSchedules } = await import("@/lib/flows/run-due-schedules"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

async function seedFlow(workspaceId: string): Promise<string> {
  const db = getDb();
  const flowId = createId();
  await db.insert(schema.flows).values({
    id: flowId,
    workspaceId,
    name: "scheduled-flow",
    status: "active",
    trigger: "schedule",
    enabled: true,
    nodes: [],
    edges: [],
  });
  return flowId;
}

describe("runDueSchedules", () => {
  it("enqueues a flow run + advances nextRunAt for a due schedule", async () => {
    enqueueCalls.length = 0;
    const db = getDb();
    const flowId = await seedFlow(wsA.id);
    const schedId = createId();
    const past = new Date(Date.now() - 60_000); // due 1 min ago
    await db.insert(schema.flowSchedules).values({
      id: schedId,
      flowId,
      workspaceId: wsA.id,
      cron: "*/5 * * * *",
      timezone: "UTC",
      enabled: true,
      nextRunAt: past,
    });

    const n = await runDueSchedules();
    expect(n).toBeGreaterThanOrEqual(1);

    // A JOB_FLOW_RUN was enqueued for our flow.
    const ours = enqueueCalls.find((c) => (c.data as { flowId?: string }).flowId === flowId);
    expect(ours).toBeTruthy();
    expect((ours!.data as { triggerSource?: string }).triggerSource).toContain("schedule");

    // A flow_run row was created (pending) so the worker has state.
    const runs = await db.select().from(schema.flowRuns).where(eq(schema.flowRuns.flowId, flowId));
    expect(runs.length).toBe(1);

    // nextRunAt advanced into the future.
    const after = await db
      .select()
      .from(schema.flowSchedules)
      .where(eq(schema.flowSchedules.id, schedId));
    expect(after[0]!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after[0]!.lastRunAt).not.toBeNull();
  });

  it("leaves a not-yet-due schedule untouched", async () => {
    enqueueCalls.length = 0;
    const db = getDb();
    const flowId = await seedFlow(wsA.id);
    const future = new Date(Date.now() + 3_600_000); // due in 1h
    await db.insert(schema.flowSchedules).values({
      id: createId(),
      flowId,
      workspaceId: wsA.id,
      cron: "*/5 * * * *",
      timezone: "UTC",
      enabled: true,
      nextRunAt: future,
    });
    await runDueSchedules();
    const skipped = enqueueCalls.find((c) => (c.data as { flowId?: string }).flowId === flowId);
    expect(skipped).toBeUndefined();
  });
});
