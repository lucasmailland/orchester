import { describe, it, expect, beforeEach, vi } from "vitest";

const { runIntegrationActionMock } = vi.hoisted(() => ({
  runIntegrationActionMock: vi.fn(
    async (
      _workspaceId: string,
      _integrationId: string,
      _action: string,
      _input: Record<string, unknown>
    ) => ({ errors: [] })
  ),
}));

vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: runIntegrationActionMock,
}));

import { getToolDefinitions, listAllTools, executeTool } from "@/lib/tools";

const CTX = { workspaceId: "ws_1", variables: {}, agentId: "agent_1" };

beforeEach(() => {
  runIntegrationActionMock.mockClear();
});

describe("newrelic agent tools", () => {
  it("are listed in the catalog", () => {
    const names = listAllTools().map((t) => t.name);
    expect(names).toContain("newrelic_get_errors");
    expect(names).toContain("newrelic_get_logs_for_trace");
    expect(names).toContain("newrelic_get_deployments");
  });

  it("keep the raw NRQL escape hatch off the model's surface", () => {
    const names = listAllTools().map((t) => t.name);
    expect(names).not.toContain("newrelic_nrql");
  });

  it("publish a typed contract", () => {
    const [def] = getToolDefinitions(["newrelic_get_errors"]);
    const props = def!.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["app_name", "since_minutes"]));
    expect(def!.inputSchema.required).toContain("app_name");
  });

  it("routes each tool to its connector action", async () => {
    const cases: [string, string][] = [
      ["newrelic_get_errors", "get_errors"],
      ["newrelic_get_logs_for_trace", "get_logs_for_trace"],
      ["newrelic_get_deployments", "get_deployments"],
    ];
    for (const [tool, action] of cases) {
      runIntegrationActionMock.mockClear();
      await executeTool(tool, { app_name: "user-service", trace_id: "t1" }, CTX);
      const [, integrationId, calledAction] = runIntegrationActionMock.mock.calls[0]!;
      expect(integrationId).toBe("newrelic");
      expect(calledAction).toBe(action);
    }
  });

  it("names trace_id in the logs tool, since that is the attribute utils writes", () => {
    const [def] = getToolDefinitions(["newrelic_get_logs_for_trace"]);
    const props = def!.inputSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("trace_id");
    expect(def!.inputSchema.required).toContain("trace_id");
  });
});
