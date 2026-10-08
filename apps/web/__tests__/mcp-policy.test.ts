// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertMcpUrl,
  mcpToolName,
  offeredMcpTools,
  parseMcpConfig,
} from "@/lib/integrations/mcp-policy";

afterEach(() => vi.unstubAllEnvs());

describe("MCP network policy", () => {
  it("blocks private hosts unless explicitly allowed, including the port", () => {
    vi.stubEnv("MCP_ALLOWED_PRIVATE_HOSTS", "");
    expect(() => assertMcpUrl("https://127.0.0.1/mcp")).toThrow();
    expect(() => assertMcpUrl("http://localhost:4321/mcp")).toThrow();
    vi.stubEnv("MCP_ALLOWED_PRIVATE_HOSTS", "localhost:4321");
    expect(assertMcpUrl("http://localhost:4321/mcp").port).toBe("4321");
    expect(() => assertMcpUrl("http://localhost:4322/mcp")).toThrow();
    expect(() => assertMcpUrl("http://localhost.example.com:4321/mcp")).toThrow();
  });
  it("requires HTTPS outside the allowlist and rejects URL credentials", () => {
    vi.stubEnv("MCP_ALLOWED_PRIVATE_HOSTS", "");
    expect(assertMcpUrl("https://mcp.example.com/mcp").protocol).toBe("https:");
    expect(() => assertMcpUrl("http://mcp.example.com/mcp")).toThrow();
    expect(() => assertMcpUrl("https://test:test@mcp.example.com/mcp")).toThrow();
    expect(() => assertMcpUrl("file:///mcp")).toThrow();
  });
});

describe("MCP tool policy", () => {
  const tools = [
    { name: "read", inputSchema: { type: "object" as const }, annotations: { readOnlyHint: true } },
    { name: "unknown", inputSchema: { type: "object" as const } },
    {
      name: "write",
      inputSchema: { type: "object" as const },
      annotations: { readOnlyHint: false },
    },
    {
      name: "destroy",
      inputSchema: { type: "object" as const },
      annotations: { readOnlyHint: true, destructiveHint: true },
    },
  ];
  it("never offers unannotated, write or destructive tools by default", () => {
    expect(offeredMcpTools(tools).map((t) => [t.name, t.effect])).toEqual([["read", "read"]]);
  });
  it("requires membership when an allowlist is set and allows explicit writes", () => {
    expect(offeredMcpTools(tools, ["unknown", "destroy"]).map((t) => [t.name, t.effect])).toEqual([
      ["unknown", "write"],
      ["destroy", "write"],
    ]);
    expect(offeredMcpTools(tools, [])).toEqual([]);
  });
  it("makes deterministic bounded provider names without sanitation collisions", () => {
    const names = ["a.b", "a/b", "a_b", "x".repeat(200)].map((name) =>
      mcpToolName("integration-test", name)
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^mcp__[a-zA-Z0-9_-]{1,59}$/);
    expect(mcpToolName("integration-test", "a.b")).toBe(names[0]);
    expect(mcpToolName("a/b", "read")).not.toBe(mcpToolName("a.b", "read"));
  });
  it("parses connector strings with timeout bounds and optional JSON allowlist", () => {
    const config = { url: "https://mcp.example.com/mcp" };
    expect(parseMcpConfig(config).timeoutMs).toBe(20000);
    expect(
      parseMcpConfig({ ...config, toolAllowlist: '["read"]', timeoutMs: "60000" }).toolAllowlist
    ).toEqual(["read"]);
    for (const timeoutMs of ["0", "-1", "60001", "NaN"])
      expect(() => parseMcpConfig({ ...config, timeoutMs })).toThrow();
    expect(() => parseMcpConfig({ ...config, toolAllowlist: '{"read":true}' })).toThrow();
  });
});
