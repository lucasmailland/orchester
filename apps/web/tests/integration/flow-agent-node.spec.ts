import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import { eq } from "drizzle-orm";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let runtime: typeof import("@/lib/agent-runtime");
let executeFlow: typeof import("@/lib/flow-engine").executeFlow;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  runtime = await import("@/lib/agent-runtime");
  ({ executeFlow } = await import("@/lib/flow-engine"));
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

it("agent node delegates to runAgent (tools/memory/responseFormat path) and stores its content", async () => {
  const spy = vi.spyOn(runtime, "runAgent").mockResolvedValue({
    content: "FROM_RUNAGENT",
    tokensUsed: 9,
    model: "claude-haiku-4-5",
  } as never);
  const db = getDb();
  const agentId = wsA.agentIds[0]!;
  const flowId = createId();
  await db.insert(schema.flows).values({
    id: flowId,
    workspaceId: wsA.id,
    name: "f",
    status: "active",
    nodes: [
      { id: "t", type: "trigger", label: "t", config: {}, position: { x: 0, y: 0 } },
      {
        id: "a",
        type: "agent",
        label: "a",
        config: { agentId, outputVar: "answer", prompt: "Reply concisely" },
        position: { x: 1, y: 0 },
      },
    ],
    edges: [{ id: "e", source: "t", target: "a" }],
  });
  const res = await executeFlow({
    flowId,
    workspaceId: wsA.id,
    triggerSource: "test",
    input: { message: "hi" },
  });
  expect(res.status).toBe("succeeded");
  expect(spy).toHaveBeenCalledTimes(1);
  const arg = spy.mock.calls[0]![0] as { agent: { id: string }; tx?: unknown };
  expect(arg.agent.id).toBe(agentId);
  expect(arg.tx).toBeDefined();
  const runRow = await db.select().from(schema.flowRuns).where(eqRun(schema, res.runId)).limit(1);
  expect((runRow[0]!.output as Record<string, unknown>).answer).toBe("FROM_RUNAGENT");
  spy.mockRestore();
});

function eqRun(schema: typeof import("@orchester/db").schema, id: string) {
  return eq(schema.flowRuns.id, id);
}
