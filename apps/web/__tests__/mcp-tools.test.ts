// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  load: vi.fn(),
  discover: vi.fn(),
  call: vi.fn(),
}));
vi.mock("@/lib/integrations/store", () => ({
  listIntegrations: mocks.list,
  loadIntegration: mocks.load,
}));
vi.mock("@/lib/integrations/mcp-client", () => ({
  discoverMcpTools: mocks.discover,
  callMcpTool: mocks.call,
}));
vi.mock("@/lib/observability", () => ({ logWithContext: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  getCurrentWorkspace: async () => ({ workspace: { id: "workspace-test" } }),
}));
import * as tools from "@/lib/tools";
import { GET } from "@/app/api/tools/route";
const definition = {
  name: "mcp__integration_test__read",
  remoteName: "read",
  description: "Read documents",
  inputSchema: { type: "object" },
  effect: "read",
};
const integration = {
  id: "integration-test",
  type: "mcp",
  name: "Documents",
  enabled: true,
  config: { url: "https://mcp.example.com/mcp", authHeader: "Bearer test-secret" },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([integration]);
  mocks.load.mockResolvedValue(integration);
  mocks.discover.mockResolvedValue([definition]);
  mocks.call.mockResolvedValue("tool output");
});
describe("workspace MCP tool registry", () => {
  it("preserves sync builtin definitions and merges selected remote definitions asynchronously", async () => {
    expect(tools.getToolDefinitions(["current_time", definition.name])).toHaveLength(1);
    expect(tools).toHaveProperty("resolveToolDefinitions");
    const definitions = await tools.resolveToolDefinitions("workspace-test", [
      "current_time",
      definition.name,
    ]);
    expect(definitions.map((tool) => tool.name)).toEqual(["current_time", definition.name]);
  });
  it("does not discover MCP tools for builtin-only agents", async () => {
    expect(tools).toHaveProperty("resolveToolDefinitions");
    await tools.resolveToolDefinitions("workspace-test", ["calculator"]);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("threads workspace and transaction through listing, loading and execution", async () => {
    const tx = { testTransaction: true } as never;
    expect(
      await tools.executeTool(
        definition.name,
        { query: "test" },
        { workspaceId: "workspace-test", variables: {}, tx }
      )
    ).toBe("tool output");
    expect(mocks.list).toHaveBeenCalledWith("workspace-test", tx);
    expect(mocks.load).toHaveBeenCalledWith("workspace-test", integration.id, tx);
    expect(mocks.call).toHaveBeenCalledWith(
      { workspaceId: "workspace-test", integrationId: integration.id },
      integration.config,
      "read",
      { query: "test" }
    );
  });
  it("refuses unavailable or disabled tools at execution", async () => {
    mocks.discover.mockResolvedValue([]);
    await expect(
      tools.executeTool(definition.name, {}, { workspaceId: "workspace-test", variables: {} })
    ).rejects.toThrow();
    mocks.list.mockResolvedValue([{ ...integration, enabled: false }]);
    await expect(
      tools.executeTool(definition.name, {}, { workspaceId: "workspace-test", variables: {} })
    ).rejects.toThrow();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("lists remote descriptions under the integration name without config in the picker API", async () => {
    const response = await GET();
    const catalog = await response.json();
    expect(catalog).toContainEqual(
      expect.objectContaining({
        id: definition.name,
        description: definition.description,
        category: "Documents",
        builtin: false,
        effect: "read",
      })
    );
    expect(JSON.stringify(catalog)).not.toContain("test-secret");
  });
  it("uses async resolution in agent runtime and both channel paths, retaining untrusted wrappers", () => {
    const runtime = readFileSync(new URL("../lib/agent-runtime.ts", import.meta.url), "utf8");
    const router = readFileSync(new URL("../lib/channels/router.ts", import.meta.url), "utf8");
    expect(runtime).toContain("await resolveToolDefinitions(p.workspaceId, enabledTools, p.tx)");
    expect(
      router.match(/await resolveToolDefinitions\(workspaceId, activeAgent.tools \?\? \[\], tx\)/g)
    ).toHaveLength(2);
    for (const source of [runtime, router])
      expect(source).toMatch(
        /const wrapped = wrapUntrusted\(\s*typeof out === "string" \? out : JSON.stringify\(out \?\? null\)/
      );
  });
});
