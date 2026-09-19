import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  flows: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  steps: [] as Array<Record<string, unknown>>,
  webhooks: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  failAudit: false,
  failInsert: false,
  versions: [] as Array<Record<string, unknown>>,
}));

// The service only talks to the DB through small repository helpers defined in
// flow-repo.ts; the test replaces them wholesale.
vi.mock("@/lib/flows/flow-repo", () => ({
  withRepo: async (_actor: unknown, fn: (repo: unknown) => Promise<unknown>) =>
    fn({
      findFlow: async (id: string, ws: string) =>
        db.flows.find((f) => f.id === id && f.workspaceId === ws),
      listFlows: async (ws: string) => db.flows.filter((f) => f.workspaceId === ws),
      insertFlow: async (row: Record<string, unknown>) =>
        db.failInsert ? undefined : (db.flows.push(row), row),
      // Guardar la versión anterior antes de pisarla: el servicio lo hace en
      // cada cambio del grafo, así que el repo de mentira también tiene que saber.
      snapshotFlow: async (flow: Record<string, unknown>, _ws: string, label: string | null) => {
        (db.versions ??= []).push({ flowId: flow["id"], version: flow["version"] ?? 1, label });
        return ((flow["version"] as number) ?? 1) + 1;
      },
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
      insertWebhook: async (row: Record<string, unknown>) =>
        db.failInsert ? undefined : (db.webhooks.push(row), row),
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
  db.failInsert = false;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
});

afterEach(() => vi.unstubAllEnvs());

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

describe("webhook URL configuration", () => {
  it("rejects missing URL configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    vi.stubEnv("BETTER_AUTH_URL", undefined);
    expect(() => svc.webhookUrl("test-secret")).toThrow("NEXT_PUBLIC_APP_URL or BETTER_AUTH_URL");
  });
  it.each([
    ["https://example.com/", "https://auth.example.com", "https://example.com"],
    [undefined, "https://auth.example.com/", "https://auth.example.com"],
  ])("returns an absolute URL with configured base %s", (app, auth, base) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", app);
    vi.stubEnv("BETTER_AUTH_URL", auth);
    expect(svc.webhookUrl("test-secret")).toBe(base + "/api/webhooks/test-secret");
  });
});

describe("service error responses", () => {
  it.each(["flow", "webhook"])("maps an empty %s insert to the existing JSON 500", async (kind) => {
    db.flows.push({ id: "f_mine", workspaceId: "ws_a" });
    db.failInsert = true;
    let failure: unknown;
    try {
      if (kind === "flow") await svc.createFlow(key, { name: "test" });
      else await svc.createFlowWebhook(key, "f_mine", {});
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "internal", message: "Insert failed" });
    const response = svc.serviceErrorResponse(failure);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Insert failed" });
  });
  it.each([
    ["not_found", 404, "Not found"],
    ["invalid", 422, "test error"],
    ["quota", 402, "test error"],
    ["template_not_found", 404, "test error"],
  ] as const)("preserves %s status and body", async (code, status, error) => {
    const response = svc.serviceErrorResponse(new svc.FlowServiceError(code, "test error"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});

describe("versiones automáticas", () => {
  it("guarda el estado anterior cuando cambia el grafo", async () => {
    db.flows.length = 0;
    db.versions = [];
    db.flows.push({
      id: "f-ver",
      workspaceId: "ws",
      name: "Con historial",
      version: 3,
      nodes: [{ id: "a" }],
      edges: [],
      variables: {},
      spec: null,
    });
    await svc.updateFlow({ kind: "user", workspaceId: "ws", userId: "u1" }, "f-ver", {
      nodes: [{ id: "a" }, { id: "b" }],
    });
    expect(db.versions).toHaveLength(1);
    // Se guarda el número que TENÍA, y el flow queda en el siguiente.
    expect(db.versions[0]).toMatchObject({ flowId: "f-ver", version: 3 });
    expect(db.flows[0]!.version).toBe(4);
  });

  it("dice quién lo cambió, para no tener que cruzar la auditoría por hora", async () => {
    db.flows.length = 0;
    db.versions = [];
    db.flows.push({
      id: "f-quien",
      workspaceId: "ws",
      name: "x",
      version: 1,
      nodes: [],
      edges: [],
      variables: {},
      spec: null,
    });
    await svc.updateFlow({ kind: "apiKey", workspaceId: "ws", keyId: "k-77" }, "f-quien", {
      nodes: [{ id: "nuevo" }],
    });
    expect(String(db.versions[0]!.label)).toContain("k-77");
  });

  it("renombrar o pausar no gasta una versión", async () => {
    db.flows.length = 0;
    db.versions = [];
    db.flows.push({
      id: "f-quieto",
      workspaceId: "ws",
      name: "antes",
      version: 1,
      nodes: [{ id: "a" }],
      edges: [],
      variables: {},
      spec: null,
    });
    const actor = { kind: "user" as const, workspaceId: "ws", userId: "u1" };
    await svc.updateFlow(actor, "f-quieto", { name: "después" });
    await svc.updateFlow(actor, "f-quieto", { status: "paused" });
    // Y volver a mandar los mismos nodos tampoco.
    await svc.updateFlow(actor, "f-quieto", { nodes: [{ id: "a" }] });
    expect(db.versions).toHaveLength(0);
    expect(db.flows[0]!.version).toBe(1);
  });
});
