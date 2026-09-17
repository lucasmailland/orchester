import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  flows: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  steps: [] as Array<Record<string, unknown>>,
  webhooks: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  failAudit: false,
}));

// The service only talks to the DB through small repository helpers defined in
// flow-repo.ts; the test replaces them wholesale.
vi.mock("@/lib/flows/flow-repo", () => ({
  withRepo: async (_actor: unknown, fn: (repo: unknown) => Promise<unknown>) =>
    fn({
      findFlow: async (id: string, ws: string) =>
        db.flows.find((f) => f.id === id && f.workspaceId === ws),
      listFlows: async (ws: string) => db.flows.filter((f) => f.workspaceId === ws),
      insertFlow: async (row: Record<string, unknown>) => (db.flows.push(row), row),
      updateFlow: async (id: string, ws: string, patch: Record<string, unknown>) => {
        const f = db.flows.find((x) => x.id === id && x.workspaceId === ws);
        if (f) Object.assign(f, patch);
        return f;
      },
      findRun: async (id: string, ws: string) =>
        db.runs.find((r) => r.id === id && r.workspaceId === ws),
      listSteps: async (runId: string) => db.steps.filter((s) => s.runId === runId),
      listRuns: async (flowId: string, ws: string, limit: number) =>
        db.runs.filter((r) => r.flowId === flowId && r.workspaceId === ws).slice(0, limit),
      insertWebhook: async (row: Record<string, unknown>) => (db.webhooks.push(row), row),
      listWebhooks: async (flowId: string, ws: string) =>
        db.webhooks.filter((w) => w.flowId === flowId && w.workspaceId === ws),
      findTemplate: async () => undefined,
      audit: async (_ws: string, entry: Record<string, unknown>) => {
        if (db.failAudit) throw new Error("audit down");
        db.audits.push(entry);
      },
    }),
}));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (e: Record<string, unknown>) => void db.audits.push(e)),
}));
vi.mock("@/lib/billing/quotas", () => ({ checkQuota: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@paralleldrive/cuid2", () => ({
  createId: () => `id_${Math.random().toString(36).slice(2)}`,
}));

const svc = await import("@/lib/flows/service");

const key = { kind: "apiKey", workspaceId: "ws_a", keyId: "key_1" } as const;
const user = { kind: "user", workspaceId: "ws_a", userId: "user_1" } as const;
const trigger = {
  id: "t",
  type: "trigger",
  label: "Start",
  config: { triggerKind: "manual" },
  position: { x: 0, y: 0 },
};

beforeEach(() => {
  db.flows = [
    {
      id: "f_other",
      workspaceId: "ws_b",
      name: "theirs",
      nodes: [],
      edges: [],
      variables: {},
      spec: null,
    },
  ];
  db.runs = [{ id: "r_other", workspaceId: "ws_b", flowId: "f_other" }];
  db.steps = [];
  db.webhooks = [];
  db.audits = [];
  db.failAudit = false;
});

describe("flow service", () => {
  it("never returns another workspace's flow or run", async () => {
    await expect(svc.getFlow(key, "f_other")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.getFlowRun(key, "r_other")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.createFlowWebhook(key, "f_other", {})).rejects.toMatchObject({
      code: "not_found",
    });
    expect(db.webhooks).toHaveLength(0);
  });

  it("strict create rejects error-level graphs with their issues", async () => {
    const bad = { id: "z", type: "teleport", config: {} };
    await expect(
      svc.createFlow(key, { name: "x", nodes: [trigger, bad] }, { strict: true })
    ).rejects.toMatchObject({
      code: "invalid",
      issues: expect.arrayContaining([expect.objectContaining({ nodeId: "z" })]),
    });
  });

  it("non-strict create keeps saving drafts, normalized", async () => {
    const { flow } = await svc.createFlow(user, {
      name: " Draft ",
      nodes: [{ id: "n", type: "note", data: { label: "N" } }],
    });
    expect(flow.name).toBe("Draft");
    expect((flow.nodes as Array<{ label: string }>)[0]!.label).toBe("N");
  });

  it("stores spec and returns documentation warnings", async () => {
    const { flow, warnings } = await svc.createFlow(
      key,
      { name: "doc", nodes: [trigger], spec: null },
      { strict: true }
    );
    expect(flow.spec).toBeNull();
    expect(warnings.some((w) => w.level === "warning")).toBe(true);
    const { flow: updated } = await svc.updateFlow(
      key,
      flow.id as string,
      { spec: "## Purpose" },
      { strict: true }
    );
    expect(updated.spec).toBe("## Purpose");
  });

  it("audits API-key writes with the key id and no user", async () => {
    await svc.createFlow(key, { name: "a" }, { strict: true });
    expect(db.audits.at(-1)).toMatchObject({
      actorKind: "api_key",
      actorUserId: null,
      meta: expect.objectContaining({ apiKeyId: "key_1" }),
    });
  });

  it("an API-key write fails when its audit entry cannot be written", async () => {
    db.failAudit = true;
    await expect(svc.createFlow(key, { name: "a" }, { strict: true })).rejects.toThrow(
      "audit down"
    );
  });

  it("creates a webhook with a usable URL and lists webhooks without secrets", async () => {
    db.flows.push({
      id: "f_mine",
      workspaceId: "ws_a",
      name: "mine",
      nodes: [],
      edges: [],
      variables: {},
      spec: null,
    });
    const hook = await svc.createFlowWebhook(key, "f_mine", { hmac: true });
    expect(svc.webhookUrl(hook.secret)).toMatch(new RegExp(`/api/webhooks/${hook.secret}$`));
    const listed = await svc.listFlowWebhooks(key, "f_mine", { redact: true });
    expect(JSON.stringify(listed)).not.toContain(hook.secret);
    expect(listed[0]).toMatchObject({ id: hook.id, hmac: true });
  });

  it("caps list_flow_runs at 100", async () => {
    db.flows.push({
      id: "f_mine",
      workspaceId: "ws_a",
      name: "mine",
      nodes: [],
      edges: [],
      variables: {},
      spec: null,
    });
    db.runs.push(
      ...Array.from({ length: 150 }, (_, i) => ({
        id: `r${i}`,
        workspaceId: "ws_a",
        flowId: "f_mine",
      }))
    );
    expect(await svc.listFlowRuns(key, "f_mine", 500)).toHaveLength(100);
    expect(await svc.listFlowRuns(key, "f_mine")).toHaveLength(20);
  });
});
