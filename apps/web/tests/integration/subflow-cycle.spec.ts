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

it("rejects a self-referential subflow with a clear cycle error (not depth-100)", async () => {
  const db = getDb();
  const flowId = createId();
  await db.insert(schema.flows).values({
    id: flowId,
    workspaceId: wsA.id,
    name: "selfref",
    status: "active",
    nodes: [
      { id: "t", type: "trigger", label: "t", config: {}, position: { x: 0, y: 0 } },
      { id: "s", type: "subflow", label: "s", config: { flowId }, position: { x: 1, y: 0 } },
    ],
    edges: [{ id: "e", source: "t", target: "s" }],
  });
  const res = await engine.executeFlow({
    flowId,
    workspaceId: wsA.id,
    triggerSource: "test",
    input: {},
  });
  expect(res.status).toBe("failed");
  expect(res.error).toMatch(/cycle|ciclo|already in the subflow chain/i);
});
