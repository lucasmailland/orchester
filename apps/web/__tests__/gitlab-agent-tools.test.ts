import { describe, it, expect, beforeEach, vi } from "vitest";

const { runIntegrationActionMock } = vi.hoisted(() => ({
  runIntegrationActionMock: vi.fn(
    async (
      _workspaceId: string,
      _integrationId: string,
      _action: string,
      _input: Record<string, unknown>
    ) => ({ results: [] })
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

describe("gitlab agent tools", () => {
  it("are listed in the catalog", () => {
    const names = listAllTools().map((t) => t.name);
    expect(names).toContain("gitlab_search_code");
    expect(names).toContain("gitlab_read_file");
    expect(names).toContain("gitlab_list_commits");
  });

  it("routes each tool to its connector action", async () => {
    const cases: [string, string][] = [
      ["gitlab_search_code", "search_code"],
      ["gitlab_read_file", "read_file"],
      ["gitlab_list_commits", "list_commits"],
    ];
    for (const [tool, action] of cases) {
      runIntegrationActionMock.mockClear();
      await executeTool(
        tool,
        { scope: "project", id: "team/svc", query: "x", project: "team/svc", path: "a.ts" },
        CTX
      );
      const [, integrationId, calledAction] = runIntegrationActionMock.mock.calls[0]!;
      expect(integrationId).toBe("gitlab");
      expect(calledAction).toBe(action);
    }
  });

  it("publishes a typed contract for each tool", () => {
    const search = getToolDefinitions(["gitlab_search_code"])[0]!;
    expect(search.inputSchema.required).toEqual(expect.arrayContaining(["scope", "id", "query"]));
    const read = getToolDefinitions(["gitlab_read_file"])[0]!;
    expect(read.inputSchema.required).toEqual(expect.arrayContaining(["project", "path"]));
    // `aroundLine` is what keeps a whole file out of the context window when a
    // stack trace already says which line to look at.
    expect(read.inputSchema.properties).toHaveProperty("aroundLine");
    const commits = getToolDefinitions(["gitlab_list_commits"])[0]!;
    expect(commits.inputSchema.required).toEqual(expect.arrayContaining(["project"]));
    expect(commits.inputSchema.properties).toHaveProperty("path");
  });

  it("keeps the write actions off the model's surface", () => {
    // The connector is read-only by design. If a write action is ever added
    // there, it must not become an agent tool without a decision.
    const names = listAllTools().map((t) => t.name);
    for (const forbidden of ["gitlab_create_mr", "gitlab_push", "gitlab_write_file"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe("every connector tool is wired on both sides", () => {
  // The tool the model sees and the action it routes to live in two separate
  // maps in tools.ts. Adding one and forgetting the other fails only at call
  // time, as "Unknown tool", with the model already committed to using it.
  const CONNECTOR_PREFIXES = ["odoo_", "newrelic_", "gitlab_"];

  it("declares a schema for each tool that routes to a connector", async () => {
    const names = listAllTools().map((t) => t.name);
    const connectorNames = names.filter((n) => CONNECTOR_PREFIXES.some((p) => n.startsWith(p)));
    expect(connectorNames.length).toBeGreaterThanOrEqual(9);

    for (const name of connectorNames) {
      // A tool with a schema but no route throws "Unknown tool"; one that
      // routes reaches the mocked store instead.
      runIntegrationActionMock.mockClear();
      await expect(
        executeTool(name, { id: 1, body_text: "x", app_name: "a", project: "p", path: "a" }, CTX)
      ).resolves.toBeDefined();
      expect(runIntegrationActionMock).toHaveBeenCalledTimes(1);
    }
  });
});

describe("flow_call describes what it actually returns", () => {
  // It used to say "returns its output". It returns a run id and nothing else,
  // and a tool description is the only thing the model reads when deciding
  // what it will get back — so that sentence told the model to report results
  // it had never seen.
  it("does not promise output", () => {
    const [def] = getToolDefinitions(["flow_call"]);
    expect(def!.description.toLowerCase()).not.toContain("returns its output");
  });

  it("says a run id comes back and the flow has not run", () => {
    const [def] = getToolDefinitions(["flow_call"]);
    const d = def!.description.toLowerCase();
    expect(d).toContain("run id");
    expect(d).toMatch(/not run|not available|never describe/);
  });
});
