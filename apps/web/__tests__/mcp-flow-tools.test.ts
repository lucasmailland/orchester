import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

const svc = vi.hoisted(() => ({
  listFlows: vi.fn(async () => [{ id: "f1", name: "One", status: "draft", nodes: [], edges: [] }]),
  getFlow: vi.fn(async () => ({
    id: "f1",
    name: "One",
    description: null,
    spec: "## Purpose",
    status: "draft",
    enabled: false,
    trigger: "manual",
    nodes: [{ id: "n", purpose: "p" }],
    edges: [],
    variables: {},
    version: 1,
  })),
  createFlow: vi.fn(async () => ({ flow: { id: "f2", name: "Two" }, warnings: [] })),
  updateFlow: vi.fn(async () => ({
    flow: { id: "f1", name: "One" },
    warnings: [{ level: "warning", message: "w" }],
  })),
  validateFlowById: vi.fn(async () => []),
  getFlowRun: vi.fn(async () => ({
    run: { id: "r1", status: "succeeded" },
    steps: [{ nodeId: "a" }, { nodeId: "b" }],
  })),
  listFlowRuns: vi.fn(async () => []),
  createFlowWebhook: vi.fn(async () => ({ id: "w1", secret: "s3cr3t", hmacKey: "k" })),
  listFlowWebhooks: vi.fn(async () => [
    { id: "w1", flowId: "f1", hmac: true, createdAt: new Date(0) },
  ]),
  webhookUrl: (s: string) => `https://example.com/api/webhooks/${s}`,
  FlowServiceError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public issues?: unknown[]
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/flows/service", () => svc);
const store = vi.hoisted(() => ({
  // Like FORCE RLS: the integration row is only visible inside a workspace transaction.
  describeIntegrationActionEffect: vi.fn(
    async (_ws: string, _id: string, action: string, _input: unknown, tx?: unknown) => {
      if (!tx) throw new Error("Integración no encontrada");
      if (action === "gone") throw new Error("Integración no encontrada");
      // An action whose effect depends on a templated input cannot be told.
      if (action === "dyn") return undefined;
      return action === "get" ? "read" : "write";
    }
  ),
}));
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: async (_ws: string, fn: (tx: unknown) => unknown) => fn({ tx: true }),
}));
vi.mock("@/lib/integrations/store", () => store);
vi.mock("@/lib/mnemo/client", () => ({ getMnemoClient: vi.fn() }));

const auth = (scopes: string[]) => ({ workspaceId: "ws_a", keyId: "key_1", scopes });

beforeEach(() =>
  Object.values(svc).forEach(
    (f) =>
      typeof f === "function" && "mockClear" in f && (f as { mockClear: () => void }).mockClear()
  )
);

describe("flow MCP tools", async () => {
  const { callMcpTool, listMcpTools } = await import("@/lib/mcp/server");
  const call = (name: string, args: Record<string, unknown>, scopes: string[] = []) =>
    callMcpTool(name, args, auth(scopes));

  it("lists the new tools", () => {
    const names = listMcpTools().map((t) => t.name);
    for (const n of [
      "get_flow",
      "describe_flow",
      "validate_flow",
      "create_flow",
      "update_flow",
      "get_flow_run",
      "list_flow_runs",
      "create_flow_webhook",
      "list_flow_webhooks",
      "update_flow_webhook",
      "delete_flow_webhook",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("get_flow adds nature per node and a summary, keeping existing fields", async () => {
    svc.getFlow.mockResolvedValueOnce({
      id: "f1",
      name: "One",
      description: null,
      spec: "",
      status: "draft",
      enabled: false,
      trigger: "manual",
      nodes: [
        { id: "a", type: "llm_prompt", label: "Ask", config: {} },
        { id: "b", type: "http", label: "Fetch", config: {} },
        { id: "c", type: "subflow", label: "Sub", config: { flowId: "f9" } },
      ],
      edges: [],
      variables: {},
      version: 1,
    } as never);
    svc.listFlows.mockResolvedValueOnce([
      { id: "f9", name: "Sub", status: "draft", nodes: [{ id: "x", type: "agent" }], edges: [] },
    ] as never);
    const out = JSON.parse(
      (await call("get_flow", { flowId: "f1" }, ["flows:read"])).content[0]!.text
    ) as {
      nodes: Array<{ id: string; nature: string; label: string }>;
      natureSummary: { counts: { ai: number }; reachesAi: boolean; aiSubflowNodeIds: string[] };
      version: number;
    };
    expect(out.nodes.map((n) => [n.id, n.nature, n.label])).toEqual([
      ["a", "ai", "Ask"],
      ["b", "code", "Fetch"],
      ["c", "code", "Sub"],
    ]);
    expect(out.natureSummary.counts.ai).toBe(1);
    expect(out.natureSummary.aiSubflowNodeIds).toEqual(["c"]);
    expect(out.version).toBe(1);
  });

  it("list_flows adds the AI step count", async () => {
    svc.listFlows.mockResolvedValueOnce([
      {
        id: "f1",
        name: "One",
        status: "draft",
        nodes: [
          { id: "a", type: "agent" },
          { id: "b", type: "http" },
        ],
        edges: [],
      },
    ] as never);
    const out = JSON.parse((await call("list_flows", {}, ["flows:read"])).content[0]!.text) as {
      flows: Array<{ id: string; ai: { steps: number; of: number; viaSubflow: boolean } }>;
    };
    expect(out.flows[0]).toMatchObject({
      id: "f1",
      name: "One",
      status: "draft",
      ai: { steps: 1, of: 2, viaSubflow: false },
    });
  });

  describe("describe_flow", () => {
    const stored = (nodes: unknown[]) => ({
      id: "f1",
      name: "One",
      enabled: true,
      kind: "pipeline",
      externalCallers: [{ name: "script" }],
      nodes,
      edges: [],
      variables: {},
    });

    it("is a read tool and refuses keys that cannot read flows", async () => {
      for (const scope of ["readonly", "agents:read", "agents:write"]) {
        const r = await call("describe_flow", { flowId: "f1" }, [scope]);
        expect(r.isError).toBe(true);
      }
      expect(svc.getFlow).not.toHaveBeenCalled();
      expect((await call("describe_flow", { flowId: "f1" }, ["flows:read"])).isError).toBeFalsy();
    });

    it("reads everything through the key's workspace and returns the sheet", async () => {
      svc.getFlow.mockResolvedValueOnce(
        stored([
          { id: "c", type: "integration", label: "C", config: { integrationId: "crm::get" } },
          { id: "d", type: "integration", label: "D", config: { integrationId: "crm::set" } },
          { id: "e", type: "integration", label: "E", config: { integrationId: "crm::gone" } },
          {
            id: "t",
            type: "integration",
            label: "T",
            config: { integrationId: "crm::dyn", input: { m: "{{method}}" } },
          },
        ]) as never
      );
      svc.listFlows.mockResolvedValueOnce([
        { id: "f1", name: "One", nodes: [] },
        {
          id: "f2",
          name: "Caller",
          nodes: [{ id: "s", type: "subflow", config: { flowId: "f1" } }],
        },
      ] as never);
      svc.listFlowWebhooks.mockResolvedValueOnce([{ id: "w1", enabled: false }] as never);
      const out = JSON.parse(
        (await call("describe_flow", { flowId: "f1" }, ["flows:read"])).content[0]!.text
      ) as {
        calls: { integrations: Array<{ nodeId: string; effect: string }> };
        calledBy: { flows: unknown[]; webhooks: unknown[]; externalCallers: unknown[] };
      };
      const actor = { kind: "apiKey", workspaceId: "ws_a", keyId: "key_1" };
      expect(svc.getFlow).toHaveBeenCalledWith(actor, "f1");
      expect(svc.listFlows).toHaveBeenCalledWith(actor);
      expect(svc.listFlowWebhooks).toHaveBeenCalledWith(actor, "f1", { redact: true });
      expect(store.describeIntegrationActionEffect.mock.calls.every((c) => c[0] === "ws_a")).toBe(
        true
      );
      expect(out.calls.integrations.map((i) => [i.nodeId, i.effect])).toEqual([
        ["c", "read"],
        ["d", "write"],
        ["e", "unknown"],
        // A "read" that depends on a templated input is not trusted.
        ["t", "unknown"],
      ]);
      expect(out.calledBy).toEqual({
        flows: [{ id: "f2", name: "Caller" }],
        externalCallers: [{ name: "script" }],
        webhooks: [{ id: "w1", enabled: false }],
      });
    });
  });

  it.each([["readonly"], ["agents:read"], ["agents:write"], ["flows:read"]])(
    "write tools refuse a key with only %s",
    async (scope) => {
      const r = await call("create_flow", { name: "x" }, [scope]);
      expect(r.isError).toBe(true);
      expect(svc.createFlow).not.toHaveBeenCalled();
    }
  );

  it.each([["readonly"], ["agents:read"], ["agents:write"]])(
    "read tools refuse a key with only %s",
    async (scope) => {
      // Reads used to be waved through for any key at all, so "readonly" could
      // read every flow, agent and conversation in the workspace.
      const r = await call("get_flow", { flowId: "f1" }, [scope]);
      expect(r.isError).toBe(true);
      expect(svc.getFlow).not.toHaveBeenCalled();
    }
  );

  it("a key that can write flows can read them without being told twice", async () => {
    const r = await call("get_flow", { flowId: "f1" }, ["flows:write"]);
    expect(r.isError).toBeFalsy();
  });

  it.each([[[]], [["write"]], [["flows:write"]]])(
    "write tools accept scopes %j",
    async (scopes) => {
      const r = await call("create_flow", { name: "x" }, scopes);
      expect(r.isError).toBeFalsy();
      expect(svc.createFlow).toHaveBeenCalledWith(
        { kind: "apiKey", workspaceId: "ws_a", keyId: "key_1" },
        expect.objectContaining({ name: "x" }),
        { strict: true }
      );
    }
  );

  describe("input validation", () => {
    const malformed: [string, unknown][] = [
      ["nodes", null],
      ["nodes", "x"],
      ["nodes", [null]],
      ["edges", null],
      ["edges", "x"],
      ["edges", [123]],
      ["variables", []],
      ["description", 123],
      ["spec", false],
      ["name", 123],
    ];
    for (const tool of ["create_flow", "update_flow"]) {
      it.each(malformed)(tool + " rejects invalid %s (%j)", async (field, value) => {
        expect(listMcpTools().map((t) => t.name)).toContain(tool);
        const r = await call(tool, { flowId: "f1", name: "Valid", [field]: value });
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toContain(field);
        expect(svc.createFlow).not.toHaveBeenCalled();
        expect(svc.updateFlow).not.toHaveBeenCalled();
      });
    }
    it.each([
      ["status", "bogus"],
      ["enabled", "true"],
    ])("update_flow rejects invalid %s", async (field, value) => {
      const r = await call("update_flow", { flowId: "f1", [field]: value });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(field);
      expect(svc.updateFlow).not.toHaveBeenCalled();
    });
    it.each(["create_flow", "update_flow"])("%s forwards a valid payload", async (tool) => {
      const payload = {
        name: "Valid",
        description: null,
        spec: "Purpose",
        nodes: [{ id: "n", type: "start", config: {} }],
        edges: [],
        variables: { count: 1 },
        ...(tool === "update_flow" ? { status: "active", enabled: true } : {}),
      };
      const r = await call(tool, { flowId: "f1", ...payload, ignored: true });
      expect(r.isError).toBeFalsy();
      const args = [
        expect.anything(),
        ...(tool === "update_flow" ? ["f1"] : []),
        payload,
        { strict: true },
      ];
      expect(tool === "update_flow" ? svc.updateFlow : svc.createFlow).toHaveBeenCalledWith(
        ...args
      );
    });
  });

  it("create_flow drops status and enabled and documents the limitation", async () => {
    const tool = listMcpTools().find((t) => t.name === "create_flow");
    expect(tool).toBeDefined();
    const r = await call("create_flow", { name: "Valid", status: "active", enabled: true });
    expect(r.isError).toBeFalsy();
    expect(svc.createFlow).toHaveBeenCalledWith(
      expect.anything(),
      { name: "Valid" },
      { strict: true }
    );
    expect(tool!.description).toContain("status");
    expect(tool!.description).toContain("enabled");
    expect(tool!.description).toContain("update_flow");
  });

  it.each(["create_flow", "update_flow"])(
    "%s returns structured validation issues",
    async (tool) => {
      expect(listMcpTools().map((t) => t.name)).toContain(tool);
      const issues = [
        { level: "error", message: "bad node", nodeId: "test_node" },
        { level: "warning", message: "missing purpose" },
      ];
      const service = tool === "create_flow" ? svc.createFlow : svc.updateFlow;
      service.mockRejectedValueOnce(
        new svc.FlowServiceError("invalid", "The flow has errors", issues)
      );
      const r = await call(tool, { flowId: "f1", name: "Valid" });
      expect(service).toHaveBeenCalledTimes(1);
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(
        "The flow has errors: [test_node] bad node; missing purpose"
      );
      expect(r.structuredContent).toEqual({ issues });
    }
  );

  it("keeps ordinary errors unstructured", async () => {
    svc.createFlow.mockRejectedValueOnce(new Error("test failure"));
    const r = await call("create_flow", { name: "Valid" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("Error: test failure");
    expect(r.structuredContent).toBeUndefined();
  });

  it("returns validation issues when a write is rejected", async () => {
    svc.createFlow.mockRejectedValueOnce(
      new svc.FlowServiceError("invalid", "The flow has errors", [
        { level: "error", message: "bad", nodeId: "z" },
      ])
    );
    const r = await call("create_flow", { name: "x", nodes: [] });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("bad");
  });

  it("get_flow returns the spec and purposes", async () => {
    const r = await call("get_flow", { flowId: "f1" }, ["flows:read"]);
    expect(r.structuredContent).toMatchObject({ spec: "## Purpose", nodes: [{ purpose: "p" }] });
  });

  it("get_flow_run returns ordered steps with a readonly key", async () => {
    const r = await call("get_flow_run", { runId: "r1" }, ["flows:read"]);
    expect(
      (r.structuredContent as { steps: Array<{ nodeId: string }> }).steps.map((s) => s.nodeId)
    ).toEqual(["a", "b"]);
  });

  it.each([
    ["nodes", "oops"],
    ["edges", "oops"],
    ["spec", 123],
  ])("validate_flow rejects invalid %s types", async (field, value) => {
    const r = await call("validate_flow", { [field]: value }, ["flows:read"]);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain(field);
    expect(r.content[0]!.text).toMatch(/expected (array|string)/i);
  });

  it("validate_flow accepts an unsaved graph", async () => {
    const r = await call(
      "validate_flow",
      { nodes: [{ id: "z", type: "teleport", config: {} }], edges: [] },
      ["flows:read"]
    );
    expect((r.structuredContent as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(svc.validateFlowById).not.toHaveBeenCalled();
  });

  it("create_flow_webhook returns the URL once; list never returns secrets", async () => {
    const created = await call("create_flow_webhook", { flowId: "f1", hmac: true }, [
      "flows:write",
    ]);
    expect(created.structuredContent).toMatchObject({
      id: "w1",
      url: "https://example.com/api/webhooks/s3cr3t",
      hmacKey: "k",
    });
    const listed = await call("list_flow_webhooks", { flowId: "f1" }, ["flows:read"]);
    expect(JSON.stringify(listed.structuredContent)).not.toContain("s3cr3t");
    expect(svc.listFlowWebhooks).toHaveBeenCalledWith(expect.anything(), "f1", { redact: true });
  });

  describe("flow kind and external callers", () => {
    const rows = [
      { id: "p1", name: "Pipe", status: "draft", kind: "pipeline", nodes: [], edges: [] },
      { id: "a1", name: "Act", status: "draft", kind: "action", nodes: [], edges: [] },
    ];
    type Listed = { flows: Array<{ id: string; kind: string }> };
    const list = async (args: Record<string, unknown>) =>
      JSON.parse((await call("list_flows", args, ["flows:read"])).content[0]!.text) as Listed;

    it("list_flows returns the kind of every flow", async () => {
      svc.listFlows.mockResolvedValueOnce(rows as never);
      const out = await list({});
      expect(out.flows.map((f) => [f.id, f.kind])).toEqual([
        ["p1", "pipeline"],
        ["a1", "action"],
      ]);
    });

    it.each([
      ["action", ["a1"]],
      ["pipeline", ["p1"]],
    ])("list_flows filters by kind=%s", async (kind, ids) => {
      svc.listFlows.mockResolvedValueOnce(rows as never);
      expect((await list({ kind })).flows.map((f) => f.id)).toEqual(ids);
    });

    it("list_flows rejects an unknown kind", async () => {
      const r = await call("list_flows", { kind: "macro" }, ["flows:read"]);
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain("kind");
    });

    it("get_flow returns kind and externalCallers", async () => {
      svc.getFlow.mockResolvedValueOnce({
        id: "a1",
        name: "Act",
        description: null,
        spec: null,
        status: "draft",
        enabled: false,
        trigger: "manual",
        nodes: [],
        edges: [],
        variables: {},
        version: 1,
        kind: "action",
        externalCallers: [{ name: "cron", note: "nightly" }],
      } as never);
      const out = JSON.parse(
        (await call("get_flow", { flowId: "a1" }, ["flows:read"])).content[0]!.text
      );
      expect(out.kind).toBe("action");
      expect(out.externalCallers).toEqual([{ name: "cron", note: "nightly" }]);
    });

    it.each(["create_flow", "update_flow"])(
      "%s forwards kind and externalCallers",
      async (tool) => {
        const payload = {
          name: "Act",
          kind: "action",
          externalCallers: [{ name: "cron", note: "nightly" }],
        };
        const r = await call(tool, { flowId: "f1", ...payload });
        expect(r.isError).toBeFalsy();
        const service = tool === "create_flow" ? svc.createFlow : svc.updateFlow;
        expect(service).toHaveBeenCalledWith(
          expect.anything(),
          ...(tool === "update_flow" ? ["f1"] : []),
          payload,
          { strict: true }
        );
      }
    );

    it("validate_flow applies the action contract to an unsaved graph", async () => {
      const node = {
        id: "m",
        type: "wait_human",
        label: "M",
        config: {},
        position: { x: 0, y: 0 },
      };
      const run = async (kind: string) =>
        JSON.parse(
          (await call("validate_flow", { nodes: [node], edges: [], kind }, ["flows:read"]))
            .content[0]!.text
        ) as { issues: Array<{ nodeId?: string; message: string }> };
      expect((await run("action")).issues.some((i) => /acci/i.test(i.message))).toBe(true);
      expect((await run("pipeline")).issues.some((i) => /acci/i.test(i.message))).toBe(false);
    });

    it("update_flow can clear the external callers", async () => {
      await call("update_flow", { flowId: "f1", externalCallers: [] });
      expect(svc.updateFlow).toHaveBeenCalledWith(
        expect.anything(),
        "f1",
        { externalCallers: [] },
        { strict: true }
      );
    });

    it.each([
      ["kind", "macro"],
      ["externalCallers", [{ name: "" }]],
      ["externalCallers", [{ name: "a".repeat(81) }]],
      ["externalCallers", [{ name: "a", note: "n".repeat(201) }]],
      ["externalCallers", Array.from({ length: 11 }, (_, i) => ({ name: `c${i}` }))],
      ["externalCallers", "cron"],
    ])("rejects invalid %s (%j)", async (field, value) => {
      for (const tool of ["create_flow", "update_flow"]) {
        const r = await call(tool, { flowId: "f1", name: "x", [field]: value });
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toContain(field);
      }
      expect(svc.createFlow).not.toHaveBeenCalled();
      expect(svc.updateFlow).not.toHaveBeenCalled();
    });
  });

  describe("step groups", () => {
    const group = { id: "g1", name: "Fetch data", icon: "Globe", nodeIds: ["a", "b"] };

    it("get_flow returns the groups, dropping malformed stored entries", async () => {
      svc.getFlow.mockResolvedValueOnce({
        id: "f1",
        name: "One",
        description: null,
        spec: null,
        status: "draft",
        enabled: false,
        trigger: "manual",
        nodes: [],
        edges: [],
        variables: {},
        version: 1,
        groups: [group, { id: "bad", name: "", nodeIds: [] }],
      } as never);
      const out = JSON.parse(
        (await call("get_flow", { flowId: "f1" }, ["flows:read"])).content[0]!.text
      );
      expect(out.groups).toEqual([group]);
    });

    it("get_flow returns an empty list for a flow without groups", async () => {
      const out = JSON.parse(
        (await call("get_flow", { flowId: "f1" }, ["flows:read"])).content[0]!.text
      );
      expect(out.groups).toEqual([]);
    });

    it.each(["create_flow", "update_flow"])("%s forwards groups", async (tool) => {
      const r = await call(tool, { flowId: "f1", name: "G", groups: [group] });
      expect(r.isError).toBeFalsy();
      const service = tool === "create_flow" ? svc.createFlow : svc.updateFlow;
      expect(service).toHaveBeenCalledWith(
        expect.anything(),
        ...(tool === "update_flow" ? ["f1"] : []),
        expect.objectContaining({ groups: [group] }),
        { strict: true }
      );
    });

    it.each([
      ["no name", { ...group, name: "" }],
      ["a description over 160 characters", { ...group, description: "d".repeat(161) }],
      ["an unknown icon", { ...group, icon: "Rocket" }],
      ["one step", { ...group, nodeIds: ["a"] }],
    ])("create_flow and update_flow reject a group with %s", async (_label, bad) => {
      for (const tool of ["create_flow", "update_flow"]) {
        const r = await call(tool, { flowId: "f1", name: "x", groups: [bad] });
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toContain("groups");
      }
      expect(svc.createFlow).not.toHaveBeenCalled();
      expect(svc.updateFlow).not.toHaveBeenCalled();
    });

    it("documents groups in the write tools' schema", () => {
      for (const name of ["create_flow", "update_flow"]) {
        const tool = listMcpTools().find((t) => t.name === name);
        expect(tool?.inputSchema.properties).toHaveProperty("groups");
      }
    });

    it("validate_flow checks the groups of an unsaved graph against its steps", async () => {
      const node = (id: string) => ({
        id,
        type: "transform",
        label: id,
        config: { template: "{}" },
        position: { x: 0, y: 0 },
      });
      const run = async (groups: unknown) =>
        JSON.parse(
          (
            await call("validate_flow", { nodes: [node("a"), node("b")], edges: [], groups }, [
              "flows:read",
            ])
          ).content[0]!.text
        ) as { issues: Array<{ message: string }> };
      const without = (await run(undefined)).issues;
      expect((await run([group])).issues).toEqual(without);
      const broken = (await run([{ ...group, nodeIds: ["a", "ghost"] }])).issues;
      expect(broken.length).toBe(without.length + 1);
      expect(broken.some((i) => i.message.includes("ghost"))).toBe(true);
    });
  });

  it("list_flows goes through the service", async () => {
    await call("list_flows", {}, ["flows:read"]);
    expect(svc.listFlows).toHaveBeenCalled();
  });

  it("documents that run_flow is not scope-gated", () => {
    const readme = readFileSync("../../README.md", "utf8");
    expect(readme).toContain(
      "`run_flow` is not scope-gated: any non-readonly workspace key can execute any flow in that workspace."
    );
  });

  it("run_flow points callers at get_flow_run", () => {
    const run = listMcpTools().find((t) => t.name === "run_flow")!;
    expect(run.description).toContain("get_flow_run");
  });
});
