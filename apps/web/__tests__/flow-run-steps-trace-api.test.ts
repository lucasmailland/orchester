import { expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  tx: undefined as unknown,
}));
vi.mock("@orchester/db", async () => ({
  schema: await import("../../../packages/db/src/schema"),
}));
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: async (_ws: string, fn: (tx: unknown) => Promise<unknown>) => fn(state.tx),
}));
vi.mock("@/lib/audit/log", () => ({
  appendAuditInTx: vi.fn(async () => ({ rotatedAtSeq: null })),
  warnChainRotated: vi.fn(),
}));

const { withRepo } = await import("@/lib/flows/flow-repo");
const actor = { kind: "apiKey", workspaceId: "ws_test", keyId: "key_test" } as const;

it("listSteps (behind GET /api/flow-runs/:id) selects the AI trace columns", async () => {
  state.queries = [];
  state.tx = drizzle(async (sql, params) => {
    state.queries.push({ sql, params });
    return { rows: [] };
  });
  await withRepo(actor, (r) => r.listSteps("run_test"));
  const { sql } = state.queries[0]!;
  for (const col of ["agent_id", "agent_name", "model", "tokens_used", "cost_usd"]) {
    expect(sql).toContain(`"${col}"`);
  }
});

it("GET /api/flow-runs/:id returns the trace fields of each step", async () => {
  vi.resetModules();
  const step = {
    id: "s1",
    agentId: "agent_1",
    agentName: "Writer",
    model: "m",
    tokensUsed: 10,
    costUsd: "0.012300",
  };
  vi.doMock("@/lib/auth-guards", () => ({
    requireAuth: async () => ({ workspace: { id: "ws_test" }, user: { id: "u1" } }),
    isAuthContext: () => true,
  }));
  vi.doMock("@/lib/flows/service", () => ({
    getFlowRun: async () => ({ run: { id: "r1" }, steps: [step] }),
    serviceErrorResponse: vi.fn(),
  }));
  const { GET } = await import("../app/api/flow-runs/[id]/route");
  const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "r1" }) });
  const body = await res.json();
  expect(body.steps[0]).toMatchObject({
    agentId: "agent_1",
    agentName: "Writer",
    model: "m",
    tokensUsed: 10,
    costUsd: "0.012300",
  });
});
