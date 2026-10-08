// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  flow: { kind: "action", enabled: true } as Record<string, unknown>,
  version: { nodes: [] as unknown[], edges: [], variables: {}, spec: null } as Record<
    string,
    unknown
  >,
  updates: [] as unknown[],
}));

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ workspace: { id: "ws_a" }, user: { id: "u1" } }),
  isAuthContext: () => true,
}));
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@orchester/db", () => {
  const schema = { flows: { key: "flows" }, flowVersions: { key: "flowVersions" } };
  const tx = {
    execute: async () => [],
    select: () => {
      let table = "";
      const q = {
        from: (t: { key: string }) => ((table = t.key), q),
        where: () => q,
        limit: async () => [table === "flows" ? h.flow : h.version],
      };
      return q;
    },
    update: () => ({
      set: (s: unknown) => ({
        where: () => ({
          returning: async () => (h.updates.push(s), [{ id: "f1" }]),
        }),
      }),
    }),
  };
  return { schema, getDb: () => ({ transaction: async (fn: (t: unknown) => unknown) => fn(tx) }) };
});

const { POST } = await import("@/app/api/flows/[id]/versions/[vid]/restore/route");
const call = () =>
  POST(new Request("http://x"), { params: Promise.resolve({ id: "f1", vid: "v1" }) });
const ai = { id: "m", type: "llm_prompt", label: "M", config: {}, position: { x: 0, y: 0 } };

beforeEach(() => {
  h.updates = [];
  h.flow = { kind: "action", enabled: true };
  h.version = { nodes: [ai], edges: [], variables: {}, spec: null };
});

describe("REST restore of a flow version", () => {
  it("refuses a version that breaks the contract of an enabled action", async () => {
    const res = await call();
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('"nodeId":"m"');
    expect(h.updates).toHaveLength(0);
  });
  it("restores it when the flow is a pipeline", async () => {
    h.flow = { kind: "pipeline", enabled: true };
    expect((await call()).status).toBe(200);
    expect(h.updates).toHaveLength(1);
  });
  it("restores it when the action is disabled (draft)", async () => {
    h.flow = { kind: "action", enabled: false };
    expect((await call()).status).toBe(200);
  });
});
