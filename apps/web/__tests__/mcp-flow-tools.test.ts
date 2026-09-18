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
      "validate_flow",
      "create_flow",
      "update_flow",
      "get_flow_run",
      "list_flow_runs",
      "create_flow_webhook",
      "list_flow_webhooks",
    ]) {
      expect(names).toContain(n);
    }
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
