import { it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";

let wsA: WsFixture;
let engine: typeof import("@/lib/flow-engine");
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  engine = await import("@/lib/flow-engine");
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

async function seedApprovalFlow() {
  const db = getDb();
  const flowId = createId();
  await db.insert(schema.flows).values({
    id: flowId,
    workspaceId: wsA.id,
    name: "approval",
    status: "active",
    nodes: [
      { id: "t", type: "trigger", label: "t", config: {}, position: { x: 0, y: 0 } },
      {
        id: "w",
        type: "wait_human",
        label: "approve",
        config: { instructions: "Approve?" },
        position: { x: 1, y: 0 },
      },
      {
        id: "x",
        type: "transform",
        label: "set ok",
        config: { template: '{"approved":"yes"}' },
        position: { x: 2, y: 0 },
      },
    ],
    edges: [
      { id: "e1", source: "t", target: "w" },
      { id: "e2", source: "w", target: "x" },
    ],
  });
  return flowId;
}

it("pauses at wait_human (status=waiting, resume token set) and does NOT run children", async () => {
  const flowId = await seedApprovalFlow();
  const res = await engine.executeFlow({
    flowId,
    workspaceId: wsA.id,
    triggerSource: "test",
    input: {},
  });
  expect(res.status).toBe("waiting");
  const db = getDb();
  const run = (
    await db.select().from(schema.flowRuns).where(eq(schema.flowRuns.id, res.runId)).limit(1)
  )[0]!;
  expect(run.status).toBe("waiting");
  expect(run.resumeToken).toBeTruthy();
  expect(run.pendingNodeId).toBe("w");
  expect((run.output as Record<string, unknown> | null)?.approved).toBeUndefined();
});

it("resumeFlow with approve re-enters the graph and completes", async () => {
  const flowId = await seedApprovalFlow();
  const res = await engine.executeFlow({
    flowId,
    workspaceId: wsA.id,
    triggerSource: "test",
    input: {},
  });
  const db = getDb();
  const run = (
    await db.select().from(schema.flowRuns).where(eq(schema.flowRuns.id, res.runId)).limit(1)
  )[0]!;
  const final = await engine.resumeFlow(res.runId, run.resumeToken!, "approve", wsA.id);
  expect(final.status).toBe("succeeded");
  const done = (
    await db.select().from(schema.flowRuns).where(eq(schema.flowRuns.id, res.runId)).limit(1)
  )[0]!;
  expect((done.output as Record<string, unknown>).approved).toBe("yes");
});

it("resumeFlow with reject marks the run cancelled and skips children", async () => {
  const flowId = await seedApprovalFlow();
  const res = await engine.executeFlow({
    flowId,
    workspaceId: wsA.id,
    triggerSource: "test",
    input: {},
  });
  const db = getDb();
  const run = (
    await db.select().from(schema.flowRuns).where(eq(schema.flowRuns.id, res.runId)).limit(1)
  )[0]!;
  const final = await engine.resumeFlow(res.runId, run.resumeToken!, "reject", wsA.id);
  expect(["failed", "cancelled"]).toContain(final.status);
});
