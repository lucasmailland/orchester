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
      findVersion: async (id: string, flowId: string, ws: string) =>
        db.versions.find(
          (v) => v["id"] === id && v["flowId"] === flowId && v["workspaceId"] === ws
        ),
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

  it("strict create carries subflow inputs/outputs and rejects malformed ones", async () => {
    const call = (config: Record<string, unknown>) => ({
      id: "s",
      type: "subflow",
      label: "Call",
      config: { flowId: "child", ...config },
      position: { x: 0, y: 0 },
    });
    const edges = [{ id: "e", source: "t", target: "s" }];
    const { flow } = await svc.createFlow(
      key,
      {
        name: "ok",
        nodes: [trigger, call({ inputs: { a: "{{x}}" }, outputs: { b: "r.total" } })],
        edges,
      },
      { strict: true }
    );
    const stored = (flow.nodes as Array<{ id: string; config: Record<string, unknown> }>).find(
      (n) => n.id === "s"
    );
    expect(stored?.config).toMatchObject({ inputs: { a: "{{x}}" }, outputs: { b: "r.total" } });
    await expect(
      svc.createFlow(
        key,
        { name: "bad", nodes: [trigger, call({ inputs: { "bad name": "x" } })], edges },
        { strict: true }
      )
    ).rejects.toMatchObject({ code: "invalid" });
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

  describe("flow kind and external callers", () => {
    const code = {
      id: "x",
      type: "transform",
      label: "X",
      config: { template: "a" },
      position: { x: 0, y: 0 },
      purpose: "p",
    };
    const ai = { ...code, id: "m", type: "llm_prompt", label: "M", config: {} };

    it("creates a pipeline without external callers by default", async () => {
      const { flow } = await svc.createFlow(key, { name: "p", nodes: [trigger] });
      expect(flow.kind).toBe("pipeline");
      expect(flow.externalCallers).toEqual([]);
    });

    it("round-trips kind and externalCallers through create and update", async () => {
      const { flow } = await svc.createFlow(
        key,
        { name: "a", kind: "action", nodes: [trigger, code], externalCallers: [{ name: "cron" }] },
        { strict: true }
      );
      expect(flow.kind).toBe("action");
      expect(flow.externalCallers).toEqual([{ name: "cron" }]);
      const { flow: updated } = await svc.updateFlow(
        key,
        flow.id as string,
        { externalCallers: [] },
        { strict: true }
      );
      expect(updated.externalCallers).toEqual([]);
      expect(updated.kind).toBe("action");
    });

    it("strict create enforces the action contract", async () => {
      await expect(
        svc.createFlow(key, { name: "a", kind: "action", nodes: [trigger, ai] }, { strict: true })
      ).rejects.toMatchObject({
        code: "invalid",
        issues: expect.arrayContaining([expect.objectContaining({ nodeId: "m" })]),
      });
    });

    it("strict update re-checks the stored graph when the kind changes", async () => {
      const { flow } = await svc.createFlow(key, { name: "p", nodes: [trigger, ai] });
      await expect(
        svc.updateFlow(key, flow.id as string, { kind: "action" }, { strict: true })
      ).rejects.toMatchObject({ code: "invalid" });
    });

    it("strict update rejects flow variables on an action", async () => {
      const { flow } = await svc.createFlow(key, { name: "a", kind: "action", nodes: [trigger] });
      await expect(
        svc.updateFlow(key, flow.id as string, { variables: { a: 1 } }, { strict: true })
      ).rejects.toMatchObject({ code: "invalid" });
    });

    describe("action contract on executable flows (REST is non-strict)", () => {
      const seed = async (over: Record<string, unknown> = {}) => {
        const { flow } = await svc.createFlow(key, { name: "p", nodes: [trigger, ai] });
        Object.assign(
          db.flows.find((f) => f.id === flow.id)!,
          over
        );
        return flow.id as string;
      };

      it("keeps drafts editable: kind=action on a disabled flow is saved", async () => {
        const id = await seed({ enabled: false });
        const { flow } = await svc.updateFlow(user, id, { kind: "action" });
        expect(flow.kind).toBe("action");
      });
      it("refuses kind=action + enabled=true while the graph violates the contract", async () => {
        const id = await seed({ enabled: true });
        await expect(svc.updateFlow(user, id, { kind: "action" })).rejects.toMatchObject({
          code: "invalid",
          issues: expect.arrayContaining([expect.objectContaining({ nodeId: "m" })]),
        });
        expect(db.flows.find((f) => f.id === id)!.kind).toBe("pipeline");
      });
      it("refuses to enable a violating action", async () => {
        const id = await seed({ enabled: false, kind: "action" });
        await expect(svc.updateFlow(user, id, { enabled: true })).rejects.toMatchObject({
          code: "invalid",
        });
      });
      it("refuses a graph edit that breaks an enabled action", async () => {
        const id = await seed({ enabled: true, kind: "action", nodes: [trigger, code] });
        await expect(svc.updateFlow(user, id, { nodes: [trigger, ai] })).rejects.toMatchObject({
          code: "invalid",
        });
      });
      it("allows enabling an action that satisfies the contract, and disabling a violating one", async () => {
        const ok = await seed({ enabled: false, kind: "action", nodes: [trigger, code] });
        await expect(svc.updateFlow(user, ok, { enabled: true })).resolves.toBeDefined();
        const bad = await seed({ enabled: true, kind: "action" });
        await expect(svc.updateFlow(user, bad, { enabled: false })).resolves.toBeDefined();
      });
      it("restore re-checks the contract of an enabled action", async () => {
        const id = await seed({ enabled: true, kind: "action", nodes: [trigger, code] });
        db.versions.push({
          id: "v1",
          flowId: id,
          workspaceId: "ws_a",
          nodes: [trigger, ai],
          edges: [],
          variables: {},
          spec: null,
        });
        await expect(svc.restoreFlowVersion(key, id, "v1")).rejects.toMatchObject({
          code: "invalid",
        });
      });
    });

    it("validateFlowById applies the action contract", async () => {
      const { flow } = await svc.createFlow(key, {
        name: "a",
        kind: "action",
        nodes: [trigger, ai],
      });
      const issues = await svc.validateFlowById(key, flow.id as string);
      expect(issues.some((i) => i.level === "error" && i.nodeId === "m")).toBe(true);
    });
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

describe("step groups (presentation only, validated on every write)", () => {
  const step = (id: string) => ({
    id,
    type: "transform",
    label: id,
    config: { template: "{}" },
    position: { x: 0, y: 0 },
  });
  const graph = { nodes: [trigger, step("a"), step("b"), step("c")], edges: [] };
  const group = { id: "g1", name: "Fetch data", icon: "Globe" as const, nodeIds: ["a", "b"] };
  const actor = { kind: "user" as const, workspaceId: "ws_a", userId: "user_1" };

  async function seed(groups: unknown[] = [group]) {
    const { flow } = await svc.createFlow(key, { name: "g", ...graph, groups: groups as never });
    db.versions = [];
    return flow;
  }

  it("create stores the groups in canonical shape", async () => {
    const { flow } = await svc.createFlow(
      key,
      { name: "g", ...graph, groups: [{ nodeIds: ["a", "b"], name: "Fetch data", id: "g1" }] },
      { strict: true }
    );
    expect(flow.groups).toEqual([{ id: "g1", name: "Fetch data", nodeIds: ["a", "b"] }]);
  });

  it("create without groups stores none", async () => {
    const { flow } = await svc.createFlow(key, { name: "g", ...graph });
    expect(flow.groups).toEqual([]);
  });

  it.each([
    ["a member that is not a step", [{ ...group, nodeIds: ["a", "ghost"] }]],
    ["a step in two groups", [group, { ...group, id: "g2", nodeIds: ["b", "c"] }]],
    ["a single-step group", [{ ...group, nodeIds: ["a"] }]],
    ["an icon outside the map", [{ ...group, icon: "Rocket" }]],
  ])("create rejects %s, even for non-strict (editor) writes", async (_label, groups) => {
    const before = db.flows.length;
    await expect(
      svc.createFlow(key, { name: "g", ...graph, groups: groups as never })
    ).rejects.toMatchObject({ code: "invalid", issues: expect.any(Array) });
    expect(db.flows).toHaveLength(before);
  });

  it("update with groups only stores them and leaves a version", async () => {
    const flow = await seed([]);
    const { flow: updated } = await svc.updateFlow(actor, flow.id, { groups: [group] });
    expect(updated.groups).toEqual([group]);
    expect(db.versions).toHaveLength(1);
  });

  it("sending the same groups again does not spend a version", async () => {
    const flow = await seed();
    await svc.updateFlow(actor, flow.id, { groups: [{ ...group }] });
    expect(db.versions).toHaveLength(0);
  });

  it("update validates groups against the nodes sent in the same patch", async () => {
    const flow = await seed([]);
    await expect(
      svc.updateFlow(actor, flow.id, { nodes: [trigger, step("a")], groups: [group] })
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("removing a step through nodes alone prunes the stored groups", async () => {
    // Callers that do not know about groups (an older client, an operator agent
    // editing steps) must not leave groups naming steps that are gone.
    const flow = await seed();
    await svc.updateFlow(actor, flow.id, {
      nodes: [...graph.nodes, step("d")],
      groups: [group, { id: "g2", name: "Rest", nodeIds: ["c", "d"] }],
    });
    const { flow: after } = await svc.updateFlow(actor, flow.id, {
      nodes: [trigger, step("a"), step("b"), step("c")],
    });
    // g2 kept only "c": a group of one step is just the step, so it is dropped.
    expect(after.groups).toEqual([group]);
  });

  it("restoring a version brings its groups back", async () => {
    const flow = await seed([]);
    db.versions = [
      {
        id: "v_groups",
        flowId: flow.id,
        workspaceId: "ws_a",
        version: 1,
        nodes: graph.nodes,
        edges: [],
        variables: {},
        spec: null,
        groups: [group],
      },
    ];
    const { flow: restored } = await svc.restoreFlowVersion(actor, flow.id, "v_groups");
    expect(restored.groups).toEqual([group]);
  });

  it("validateFlowById reports the same issues with or without groups", async () => {
    const plain = await seed([]);
    const grouped = await seed([group]);
    expect(await svc.validateFlowById(key, grouped.id)).toEqual(
      await svc.validateFlowById(key, plain.id)
    );
  });
});
