import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import fs from "node:fs";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";

let wsA: WsFixture;
let wsB: WsFixture;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let sqlTag: typeof import("drizzle-orm").sql;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));
  ({ sql: sqlTag, eq } = await import("drizzle-orm"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

const DAY = 86_400_000;

it("0071 assigns each agent what it used successfully in the last 90 days, once", async () => {
  const db = getDb();
  const [agent, untouched, preset] = wsA.agentIds as [string, string, string];
  const integ = (id: string, workspaceId: string, type: string) => ({
    id,
    workspaceId,
    type,
    name: id,
    configEncrypted: "x",
  });
  const [A, C, ODOO, ODOO_B] = ["int_a", "int_c", "int_odoo", "int_odoo_b"];
  await db
    .insert(schema.workspaceIntegrations)
    .values([
      integ(A, wsA.id, "http"),
      integ(C, wsA.id, "resend"),
      integ(ODOO, wsA.id, "odoo"),
      integ(ODOO_B, wsB.id, "odoo"),
    ]);
  const [F, GONE] = ["flow_f", "flow_gone"];
  await db.insert(schema.flows).values({ id: F, workspaceId: wsA.id, name: "F" } as never);

  await db
    .update(schema.agents)
    .set({ tools: ["run_integration", "flow_call"], config: { keep: 1 } })
    .where(eq(schema.agents.id, agent));
  await db
    .update(schema.agents)
    .set({ tools: ["run_integration"], config: { allowedIntegrationIds: [C] } })
    .where(eq(schema.agents.id, preset));

  const call = (
    tool: string,
    input: Record<string, unknown>,
    daysAgo: number,
    outcome = "ok",
    agentId = agent
  ) => ({
    id: createId(),
    workspaceId: wsA.id,
    createdAt: new Date(Date.now() - daysAgo * DAY),
    source: "api",
    agentId,
    tool,
    integrationType: typeof input.integrationId === "string" ? input.integrationId : null,
    input,
    outcome,
    durationMs: 1,
  });
  await db
    .insert(schema.toolCalls)
    .values([
      call("run_integration", { integrationId: A, action: "x" }, 3),
      call("run_integration", { integrationId: "odoo", action: "x" }, 10),
      call("run_integration", { integrationId: C, action: "x" }, 100),
      call("run_integration", { integrationId: C, action: "x" }, 1, "error"),
      call("flow_call", { flowId: F }, 5),
      call("flow_call", { flowId: GONE }, 5),
      call("run_integration", { integrationId: A, action: "x" }, 1, "ok", untouched),
      call("run_integration", { integrationId: A, action: "x" }, 1, "ok", preset),
    ]);

  // A JSON null config (not SQL NULL) must become an object, not [null, {...}].
  const nullCfg = wsB.agentIds[0]!;
  await db.execute(
    sqlTag`UPDATE agent SET tools = '["run_integration","flow_call"]'::jsonb, config = 'null'::jsonb WHERE id = ${nullCfg}`
  );

  const file = path.resolve(
    __dirname,
    "../../../../packages/db/migrations/0071_agent_tool_scope_backfill.sql"
  );
  const body = fs.readFileSync(file, "utf8");
  await db.execute(sqlTag.raw(body));
  const config = async (id: string) =>
    (await db.select().from(schema.agents).where(eq(schema.agents.id, id)))[0]!.config as Record<
      string,
      unknown
    >;
  const after = await config(agent);
  expect(after.keep).toBe(1);
  expect([...(after.allowedIntegrationIds as string[])].sort()).toEqual([A, ODOO].sort());
  expect(after.allowedFlowIds).toEqual([F]);
  // Without either tool: not touched.
  expect(await config(untouched)).not.toHaveProperty("allowedIntegrationIds");
  // A list already set is left alone.
  expect((await config(preset)).allowedIntegrationIds).toEqual([C]);

  expect(await config(nullCfg)).toEqual({ allowedIntegrationIds: [], allowedFlowIds: [] });

  await db.execute(sqlTag.raw(body)); // re-running changes nothing
  expect(await config(agent)).toEqual(after);
});
