import { describe, it, expect, vi } from "vitest";

// `run_integration` resolves the effect of an arbitrary configured integration,
// which needs the workspace's rows. The connector-backed tools do not: their
// action is fixed, so they are classified from the real registry.
const { getIntegrationActionEffectMock } = vi.hoisted(() => ({
  getIntegrationActionEffectMock: vi.fn(async () => "read" as const),
}));
vi.mock("@/lib/integrations/store", () => ({
  getIntegrationActionEffect: getIntegrationActionEffectMock,
  runIntegrationAction: vi.fn(),
}));

import { listAllTools, toolEffect } from "@/lib/tools";

const CTX = { workspaceId: "ws_1" };

describe("toolEffect", () => {
  it("classifies every built-in tool", async () => {
    // A new tool must be classified on purpose, not fall to `write` by accident
    // and silently stop working in dry runs (or worse, the other way round).
    for (const t of listAllTools()) {
      const e = await toolEffect(t.name, {}, CTX);
      expect(["read", "write"], t.name).toContain(e);
    }
  });

  it("inherits the connector action's declared effect", async () => {
    expect(await toolEffect("odoo_get_task", { id: 1 }, CTX)).toBe("read");
    expect(await toolEffect("odoo_search_tasks", {}, CTX)).toBe("read");
    expect(await toolEffect("gitlab_read_file", {}, CTX)).toBe("read");
    expect(await toolEffect("odoo_post_note", { id: 1, body_text: "x" }, CTX)).toBe("write");
    expect(await toolEffect("odoo_create_ticket", { name: "x" }, CTX)).toBe("write");
  });

  it("treats tools that change state as writes", async () => {
    for (const name of [
      "flow_call",
      "agent_handoff",
      "memory_set",
      "memory_remove",
      "mnemosyne_remember",
    ]) {
      expect(await toolEffect(name, {}, CTX), name).toBe("write");
    }
  });

  it("treats lookups as reads", async () => {
    for (const name of ["current_time", "calculator", "agent_team_list", "knowledge_search"]) {
      expect(await toolEffect(name, {}, CTX), name).toBe("read");
    }
  });

  it("reads http_request only for GET and HEAD", async () => {
    expect(await toolEffect("http_request", { url: "https://x.test" }, CTX)).toBe("read");
    expect(await toolEffect("http_request", { url: "https://x.test", method: "GET" }, CTX)).toBe(
      "read"
    );
    expect(await toolEffect("http_request", { url: "https://x.test", method: "POST" }, CTX)).toBe(
      "write"
    );
  });

  it("asks the store for run_integration", async () => {
    getIntegrationActionEffectMock.mockResolvedValueOnce("read");
    expect(await toolEffect("run_integration", { integrationId: "i1", action: "query" }, CTX)).toBe(
      "read"
    );
  });

  it("rejects run_integration when the action cannot be resolved", async () => {
    getIntegrationActionEffectMock.mockRejectedValueOnce(new Error("not connected"));
    await expect(
      toolEffect("run_integration", { integrationId: "i1", action: "query" }, CTX)
    ).rejects.toThrow("not connected");
  });

  it("rejects an unknown tool name instead of simulating a write", async () => {
    await expect(toolEffect("something_new", {}, CTX)).rejects.toThrow(
      "Unknown tool: something_new"
    );
  });

  it("keeps workspace MCP tools and unclassified built-ins as writes", async () => {
    expect(await toolEffect("mcp__srv__do", {}, CTX)).toBe("write");
    expect(await toolEffect("flow_call", {}, CTX)).toBe("write");
  });
});
