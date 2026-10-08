// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  callMcpTool,
  discoverMcpTools,
  invalidateMcpTools,
  testMcpConnection,
} from "@/lib/integrations/mcp-client";
import { logWithContext } from "@/lib/observability";

vi.mock("@/lib/observability", () => ({ logWithContext: vi.fn(), recordMetric: vi.fn() }));
const config = { url: "https://mcp.example.com/mcp", authHeader: "Bearer test-secret" };
const identity = { workspaceId: "workspace-test", integrationId: "integration-test" };
let servers: Server[];
let sessions: Map<string, WebStandardStreamableHTTPServerTransport>;
let listed: number;
let called: string[];
let tools: Tool[];
let failCall: boolean;
let stall: boolean;
let authorization: string | null;
let fetchMock: ReturnType<
  typeof vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>
>;

beforeEach(() => {
  servers = [];
  sessions = new Map();
  listed = 0;
  called = [];
  failCall = false;
  stall = false;
  authorization = null;
  tools = [
    {
      name: "read.docs",
      description: "Read documents",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    },
    { name: "delete", inputSchema: { type: "object" }, annotations: { destructiveHint: true } },
  ];
  invalidateMcpTools(identity.workspaceId, identity.integrationId);
  vi.stubEnv("MCP_ALLOWED_PRIVATE_HOSTS", "");
  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    authorization = req.headers.get("authorization");
    if (stall) return new Promise<Response>(() => {});
    let transport = sessions.get(req.headers.get("mcp-session-id") ?? "");
    if (!transport) {
      const id = `session-${servers.length}`;
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => id,
        enableJsonResponse: true,
      });
      sessions.set(id, transport);
      const server = new Server(
        { name: "test-server", version: "1" },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        listed++;
        return { tools };
      });
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        called.push(params.name);
        return {
          isError: failCall,
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
            { type: "image", mimeType: "image/png", data: "AA==" },
          ],
        };
      });
      await server.connect(transport);
      servers.push(server);
    }
    return transport.handleRequest(req);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("official MCP Streamable HTTP client", () => {
  it("initializes, lists and maps tools with sanitized definitions", async () => {
    const definitions = await discoverMcpTools(identity, config);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      name: expect.stringMatching(/^mcp__[a-zA-Z0-9_-]+$/),
      description: "Read documents",
      effect: "read",
      remoteName: "read.docs",
    });
    expect(definitions[0]!.name.length).toBeLessThanOrEqual(64);
    expect(authorization).toBe(config.authHeader);
    expect(listed).toBe(1);
  });
  it("tests initialization and listing without exposing server metadata or secrets", async () => {
    expect(await testMcpConnection(config)).toEqual({ ok: true, meta: { toolCount: 2 } });
    expect(listed).toBe(1);
  });
  it("returns joined text and a non-text placeholder, logging argument keys only", async () => {
    const result = await callMcpTool(identity, config, "read.docs", {
      query: "test-sensitive-value",
    });
    expect(result).toBe("first\nsecond\n[non-text content omitted]");
    expect(called).toEqual(["read.docs"]);
    expect(logWithContext).toHaveBeenCalledWith(
      "info",
      "mcp.tool.call",
      expect.objectContaining({
        integrationId: identity.integrationId,
        tool: "read.docs",
        ok: true,
        argumentKeys: ["query"],
        durationMs: expect.any(Number),
      })
    );
    expect(JSON.stringify(vi.mocked(logWithContext).mock.calls)).not.toContain(
      "test-sensitive-value"
    );
  });
  it("throws for remote isError without leaking remote content", async () => {
    failCall = true;
    await expect(callMcpTool(identity, config, "read.docs", {})).rejects.toThrow(
      "MCP tool returned an error"
    );
    expect(logWithContext).toHaveBeenCalledWith(
      "warn",
      "mcp.tool.call",
      expect.objectContaining({ ok: false })
    );
  });
  it("throws sanitized transport errors and does not expose them in connector test results", async () => {
    fetchMock.mockRejectedValue(new Error(config.authHeader));
    await expect(callMcpTool(identity, config, "read.docs", {})).rejects.toThrow(
      "MCP operation failed"
    );
    expect(JSON.stringify(await testMcpConnection(config))).not.toContain(config.authHeader);
  });
  it("bounds the entire operation, including initialization", async () => {
    stall = true;
    await expect(
      callMcpTool(identity, { ...config, timeoutMs: "20" }, "read.docs", {})
    ).rejects.toThrow(/timed out/);
  });
  it("caches list for five minutes, expires it and invalidates updates", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await discoverMcpTools(identity, config);
    await discoverMcpTools(identity, config);
    expect(listed).toBe(1);
    now += 300_001;
    await discoverMcpTools(identity, config);
    expect(listed).toBe(2);
    invalidateMcpTools(identity.workspaceId, identity.integrationId);
    await discoverMcpTools(identity, config);
    expect(listed).toBe(3);
    await discoverMcpTools(identity, { ...config, toolAllowlist: '["delete"]' });
    expect(listed).toBe(4);
    expect(
      await discoverMcpTools({ ...identity, workspaceId: "other-workspace" }, config)
    ).toHaveLength(1);
    expect(listed).toBe(5);
  });
  it("terminates the remote session after each operation", async () => {
    await testMcpConnection(config);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });
  it("bounds a hanging tools/call after successful initialization", async () => {
    const handler = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (typeof init?.body === "string" && JSON.parse(init.body).method === "tools/call") {
        return new Promise<Response>(() => {});
      }
      return handler(input, init);
    });
    await expect(
      callMcpTool(identity, { ...config, timeoutMs: "20" }, "read.docs", {})
    ).rejects.toThrow(/timed out/);
  });
  it("blocks redirects on every transport fetch to protect the guard and credentials", async () => {
    await discoverMcpTools(identity, config);
    for (const [, init] of fetchMock.mock.calls) expect(init?.redirect).toBe("error");
  });
});
