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
import { mcpHashedToolName } from "@/lib/integrations/mcp-policy";
import { executeWorkspaceMcpTool, listWorkspaceMcpTools } from "@/lib/integrations/mcp-tools";
import { assertToolOffered } from "@/lib/tool-availability";
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
    const offeredTools = await tools.resolveToolDefinitions(
      "workspace-test",
      [definition.name],
      tx
    );
    expect(
      await tools.executeTool(
        definition.name,
        { query: "test" },
        { workspaceId: "workspace-test", variables: {}, tx, offeredTools }
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
  describe("name collisions across integrations", () => {
    // key "a_" + tool "b" and key "a" + tool "_b" both read mcp__a___b.
    const a = { ...integration, id: "a_", name: "A" };
    const b = { ...integration, id: "a", name: "B" };
    const setup = (order: (typeof a)[]) => {
      mocks.list.mockResolvedValue(order);
      mocks.load.mockImplementation(async (_w: string, id: string) =>
        order.find((i) => i.id === id)
      );
      mocks.discover.mockImplementation(async (identity: { integrationId: string }) => {
        const remote = identity.integrationId === "a_" ? "b" : "_b";
        return [{ ...definition, name: "mcp__a___b", remoteName: remote }];
      });
    };
    it("hashes every colliding entry, independent of list order", async () => {
      setup([a, b]);
      const first = await listWorkspaceMcpTools("workspace-test");
      setup([b, a]);
      const second = await listWorkspaceMcpTools("workspace-test");
      const names = (list: typeof first) =>
        Object.fromEntries(list.map((t) => [t.integrationId, t.name]));
      expect(names(first)).toEqual(names(second));
      expect(names(first)["a_"]).toBe(mcpHashedToolName("a_", "b"));
      expect(names(first)["a"]).toBe(mcpHashedToolName("a", "_b"));
      expect(new Set(first.map((t) => t.name)).size).toBe(2);
    });
    it("routes both hashed names to the exact integration and remote tool", async () => {
      setup([a, b]);
      const offeredTools = await tools.resolveToolDefinitions("workspace-test", [
        mcpHashedToolName("a_", "b"),
        mcpHashedToolName("a", "_b"),
      ]);
      const ctx = { workspaceId: "workspace-test", variables: {}, offeredTools };
      await tools.executeTool(mcpHashedToolName("a_", "b"), { q: 1 }, ctx);
      expect(mocks.call).toHaveBeenLastCalledWith(
        { workspaceId: "workspace-test", integrationId: "a_" },
        a.config,
        "b",
        { q: 1 }
      );
      await tools.executeTool(mcpHashedToolName("a", "_b"), {}, ctx);
      expect(mocks.call).toHaveBeenLastCalledWith(
        { workspaceId: "workspace-test", integrationId: "a" },
        b.config,
        "_b",
        {}
      );
      await expect(tools.executeTool("mcp__a___b", {}, ctx)).rejects.toThrow();
    });

    it.each([false, true])(
      "refuses an ambiguous alias in either offered order (reversed=%s)",
      async (reversed) => {
        setup([a, b]);
        const offeredTools = await tools.resolveToolDefinitions("workspace-test", [
          mcpHashedToolName("a_", "b"),
          mcpHashedToolName("a", "_b"),
        ]);
        if (reversed) offeredTools.reverse();
        const name = "mcp__a___b";
        expect(() => assertToolOffered(name, offeredTools)).toThrow(
          `Tool "${name}" is not available for this agent`
        );
        const ctx = { workspaceId: "workspace-test", variables: {}, offeredTools };
        await expect(executeWorkspaceMcpTool(name, {}, ctx)).rejects.toThrow();
        await expect(tools.executeTool(name, {}, ctx)).rejects.toThrow();
        expect(mocks.call).not.toHaveBeenCalled();
      }
    );

    it.each([false, true])(
      "retains a colliding tool's checked identity when its integration disappears (checked=%s)",
      async (checked) => {
        setup([a, b]);
        mocks.discover.mockImplementation(async (identity: { integrationId: string }) => [
          {
            ...definition,
            name: "mcp__a___b",
            remoteName: identity.integrationId === "a_" ? "b" : "_b",
            effect: identity.integrationId === "a_" ? "read" : "write",
          },
        ]);
        const offeredTools = await tools.resolveToolDefinitions("workspace-test", [
          mcpHashedToolName("a_", "b"),
        ]);
        const offeredTool = assertToolOffered("mcp__a___b", offeredTools);
        expect(offeredTool).toMatchObject({ integrationId: "a_", remoteName: "b", effect: "read" });
        setup([b]);
        const ctx = {
          workspaceId: "workspace-test",
          variables: {},
          offeredTools,
          ...(checked ? { offeredTool } : {}),
        };
        await expect(executeWorkspaceMcpTool("mcp__a___b", {}, ctx)).rejects.toThrow(
          'Tool "mcp__a___b" is not available for this agent'
        );
        expect(mocks.call).not.toHaveBeenCalled();
      }
    );
  });
  it("routes readable and hashed names alike", async () => {
    const hashed = mcpHashedToolName("integration-test", "read.docs");
    mocks.discover.mockResolvedValue([
      { ...definition, name: "mcp__integration-test__read_docs", remoteName: "read_docs" },
      { ...definition, name: hashed, remoteName: "read.docs" },
    ]);
    const offeredTools = await tools.resolveToolDefinitions("workspace-test", [
      "mcp__integration-test__read_docs",
      hashed,
    ]);
    const ctx = { workspaceId: "workspace-test", variables: {}, offeredTools };
    await tools.executeTool("mcp__integration-test__read_docs", {}, ctx);
    expect(mocks.call).toHaveBeenLastCalledWith(
      expect.anything(),
      integration.config,
      "read_docs",
      {}
    );
    await tools.executeTool(hashed, {}, ctx);
    expect(mocks.call).toHaveBeenLastCalledWith(
      expect.anything(),
      integration.config,
      "read.docs",
      {}
    );
  });
  describe("agents that saved the legacy hashed name", () => {
    // Readable names replaced hashed ones; selections stored before keep working.
    const readable = "mcp__integration-test__read_docs";
    const legacy = mcpHashedToolName("integration-test", "read_docs");
    beforeEach(() => {
      mocks.discover.mockResolvedValue([
        { ...definition, name: readable, remoteName: "read_docs" },
      ]);
    });
    it("offers the tool under the name the agent stored", async () => {
      const defs = await tools.resolveToolDefinitions("workspace-test", [legacy]);
      expect(defs.map((d) => d.name)).toEqual([legacy]);
    });
    it("offers it once, under the readable name, when both are stored", async () => {
      const defs = await tools.resolveToolDefinitions("workspace-test", [legacy, readable]);
      expect(defs.map((d) => d.name)).toEqual([readable]);
    });
    it("offers the readable name to an agent that stored it", async () => {
      const defs = await tools.resolveToolDefinitions("workspace-test", [readable]);
      expect(defs.map((d) => d.name)).toEqual([readable]);
    });
    it.each([readable, legacy])("executes both aliases when %s was offered", async (offered) => {
      const offeredTools = await tools.resolveToolDefinitions("workspace-test", [offered]);
      const ctx = { workspaceId: "workspace-test", variables: {}, offeredTools };
      await tools.executeTool(legacy, { q: 1 }, ctx);
      expect(mocks.call).toHaveBeenLastCalledWith(
        { workspaceId: "workspace-test", integrationId: "integration-test" },
        integration.config,
        "read_docs",
        { q: 1 }
      );
      await tools.executeTool(readable, {}, ctx);
      expect(mocks.call).toHaveBeenLastCalledWith(
        expect.anything(),
        integration.config,
        "read_docs",
        {}
      );
    });
    it("does not list the alias in the picker API", async () => {
      const catalog = await (await GET()).json();
      expect(catalog.map((t: { id: string }) => t.id)).not.toContain(legacy);
    });
  });
  it("refuses unavailable or disabled tools at execution", async () => {
    const offeredTools = await tools.resolveToolDefinitions("workspace-test", [definition.name]);
    const ctx = { workspaceId: "workspace-test", variables: {}, offeredTools };
    mocks.discover.mockResolvedValue([]);
    await expect(tools.executeTool(definition.name, {}, ctx)).rejects.toThrow();
    mocks.list.mockResolvedValue([{ ...integration, enabled: false }]);
    await expect(tools.executeTool(definition.name, {}, ctx)).rejects.toThrow();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it.each([undefined, []])(
    "refuses execution without offered definitions (%j)",
    async (offeredTools) => {
      const ctx: tools.ToolContext = { workspaceId: "workspace-test", variables: {} };
      if (offeredTools) ctx.offeredTools = offeredTools;
      await expect(executeWorkspaceMcpTool(definition.name, {}, ctx)).rejects.toThrow(
        `Tool "${definition.name}" is not available for this agent`
      );
      expect(mocks.discover).not.toHaveBeenCalled();
      expect(mocks.call).not.toHaveBeenCalled();
    }
  );

  it.each(["integrationId", "remoteName"] as const)(
    "refuses an offered MCP definition without %s",
    async (missing) => {
      const offeredTools = await tools.resolveToolDefinitions("workspace-test", [definition.name]);
      const offeredTool = offeredTools[0]!;
      delete offeredTool[missing];
      for (const checked of [false, true]) {
        await expect(
          executeWorkspaceMcpTool(
            definition.name,
            {},
            {
              workspaceId: "workspace-test",
              variables: {},
              offeredTools,
              ...(checked ? { offeredTool } : {}),
            }
          )
        ).rejects.toThrow(`Tool "${definition.name}" is not available for this agent`);
      }
      expect(mocks.call).not.toHaveBeenCalled();
      expect(mocks.discover).toHaveBeenCalledTimes(1);
    }
  );

  it("requires offered definitions even when a checked MCP definition is provided", async () => {
    const [offeredTool] = await tools.resolveToolDefinitions("workspace-test", [definition.name]);
    await expect(
      executeWorkspaceMcpTool(
        definition.name,
        {},
        {
          workspaceId: "workspace-test",
          variables: {},
          offeredTool: offeredTool!,
        }
      )
    ).rejects.toThrow(`Tool "${definition.name}" is not available for this agent`);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("refuses a requested name that does not match the checked MCP definition", async () => {
    const offeredTools = await tools.resolveToolDefinitions("workspace-test", [definition.name]);
    const name = "mcp__integration-test__other";
    await expect(
      executeWorkspaceMcpTool(
        name,
        {},
        {
          workspaceId: "workspace-test",
          variables: {},
          offeredTools,
          offeredTool: offeredTools[0]!,
        }
      )
    ).rejects.toThrow(`Tool "${name}" is not available for this agent`);
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.discover).toHaveBeenCalledTimes(1);
  });

  it.each(["mcp__integration-test__other", mcpHashedToolName("integration-test", "other")])(
    "refuses an MCP tool selected by another agent: %s",
    async (name) => {
      const other = { ...definition, name: "mcp__integration-test__other", remoteName: "other" };
      mocks.discover.mockResolvedValue([definition, other]);
      const offeredTools = await tools.resolveToolDefinitions("workspace-test", [definition.name]);
      const otherAgentTools = await tools.resolveToolDefinitions("workspace-test", [other.name]);
      expect(otherAgentTools.map((tool) => tool.name)).toEqual([other.name]);
      const ctx = { workspaceId: "workspace-test", variables: {}, offeredTools };
      for (const execute of [executeWorkspaceMcpTool, tools.executeTool]) {
        await expect(execute(name, {}, ctx)).rejects.toThrow(
          `Tool "${name}" is not available for this agent`
        );
      }
      expect(mocks.call).not.toHaveBeenCalled();
    }
  );

  it("keeps an offered MCP name bound to its original identity after discovery changes", async () => {
    const offeredTools = await tools.resolveToolDefinitions("workspace-test", [definition.name]);
    mocks.discover.mockResolvedValue([{ ...definition, remoteName: "other" }]);
    await expect(
      executeWorkspaceMcpTool(
        definition.name,
        {},
        {
          workspaceId: "workspace-test",
          variables: {},
          offeredTools,
        }
      )
    ).rejects.toThrow(`Tool "${definition.name}" is not available for this agent`);
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
    expect(runtime).toContain(
      "await resolveToolDefinitions(p.workspaceId, enabledTools, p.tx, p.agent)"
    );
    expect(
      router.match(
        /await resolveToolDefinitions\(\s*workspaceId,\s*activeAgent.tools \?\? \[\],\s*tx,\s*activeAgent\s*\)/g
      )
    ).toHaveLength(2);
    for (const source of [runtime, router])
      expect(source).toMatch(
        /const wrapped = (?:wrapUntrusted\(\s*typeof out === "string" \? out : JSON.stringify\(out \?\? null\)|mapToolOutputText\(out, \(text\) => wrapUntrusted\(text,)/
      );
  });
});
