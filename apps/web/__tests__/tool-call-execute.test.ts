// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  log: vi.fn(),
  withWorkspaceTx: vi.fn(),
  runAction: vi.fn(),
  runMcp: vi.fn(),
}));

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => ({})),
  schema: { toolCalls: { table: "tool_call" } },
}));
vi.mock("@/lib/tenant/context", () => ({ withWorkspaceTx: h.withWorkspaceTx }));
vi.mock("@/lib/observability", () => ({ logWithContext: h.log, recordMetric: vi.fn() }));
vi.mock("@/lib/integrations/store", () => ({ runIntegrationAction: h.runAction }));
vi.mock("@/lib/integrations/mcp-tools", () => ({ executeWorkspaceMcpTool: h.runMcp }));

import { executeTool, type ToolContext } from "@/lib/tools";

const recordTx = {
  insert: (table: unknown) => ({
    values: async (row: Record<string, unknown>) => {
      expect(table).toEqual({ table: "tool_call" });
      h.rows.push(row);
    },
  }),
};

const CTX: ToolContext = { workspaceId: "ws_1", variables: {}, agentId: "agent_1" };

beforeEach(() => {
  h.rows = [];
  h.log.mockReset();
  h.runAction.mockReset();
  h.runMcp.mockReset();
  h.withWorkspaceTx.mockReset();
  h.withWorkspaceTx.mockImplementation(async (_ws: string, fn: (tx: unknown) => unknown) =>
    fn(recordTx)
  );
});

describe("executeTool records every call", () => {
  it("records one row with the caller's context and returns the same result", async () => {
    const out = await executeTool(
      "calculator",
      { expression: "2 + 3" },
      { ...CTX, source: "channel", conversationId: "conv_1", channelId: "channel_1" }
    );
    expect(out).toEqual({ expression: "2 + 3", result: 5 });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      workspaceId: "ws_1",
      source: "channel",
      agentId: "agent_1",
      conversationId: "conv_1",
      channelId: "channel_1",
      tool: "calculator",
      integrationType: null,
      input: { expression: "2 + 3" },
      outcome: "ok",
      resultSize: JSON.stringify(out).length,
    });
    expect(h.rows[0]!.durationMs).toEqual(expect.any(Number));
  });

  it("defaults the source to api", async () => {
    await executeTool("calculator", { expression: "1" }, CTX);
    expect(h.rows[0]!.source).toBe("api");
  });

  it("records flow context", async () => {
    await executeTool(
      "calculator",
      { expression: "1" },
      { ...CTX, source: "flow_agent", flowId: "flow_1", flowRunId: "run_1", nodeId: "node_1" }
    );
    expect(h.rows[0]).toMatchObject({
      source: "flow_agent",
      flowId: "flow_1",
      flowRunId: "run_1",
      nodeId: "node_1",
    });
  });

  it("records the integration and the ref of a connector tool, never its output", async () => {
    const result = { name: "OUTPUT-MARKER title of task", stage: "open" };
    h.runAction.mockResolvedValue(result);
    const out = await executeTool("odoo_get_task", { id: 4512 }, CTX);
    expect(out).toBe(result);
    expect(h.rows[0]).toMatchObject({
      tool: "odoo_get_task",
      integrationType: "odoo",
      ref: "odoo:4512",
      outcome: "ok",
      resultSize: JSON.stringify(result).length,
    });
    expect(JSON.stringify(h.rows)).not.toContain("OUTPUT-MARKER");
  });

  it("records the integration key of an MCP tool", async () => {
    h.runMcp.mockResolvedValue("page body");
    expect(await executeTool("mcp__docs__read_page", { page: "intro" }, CTX)).toBe("page body");
    expect(h.rows[0]).toMatchObject({ integrationType: "mcp", integrationId: "docs" });
  });

  it("records a throwing tool as an error and rethrows the same error", async () => {
    const boom = new Error("odoo down");
    h.runAction.mockRejectedValue(boom);
    await expect(executeTool("odoo_get_task", { id: 4512 }, CTX)).rejects.toBe(boom);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ outcome: "error", error: "odoo down", resultSize: null });
  });

  it("records an unknown tool as an error", async () => {
    await expect(executeTool("no_such_tool", {}, CTX)).rejects.toThrow(/Unknown tool/);
    expect(h.rows[0]).toMatchObject({ tool: "no_such_tool", outcome: "error" });
  });

  it("records a write-scope refusal as refused", async () => {
    const refusal = new Error(
      "Agents may only write to tasks of project 12; task 4512 is in project 31."
    );
    h.runAction.mockRejectedValue(refusal);
    await expect(
      executeTool("odoo_post_task_note", { id: 4512, body_markdown: "hi" }, CTX)
    ).rejects.toBe(refusal);
    expect(h.rows[0]).toMatchObject({
      outcome: "refused",
      errorCode: "write_scope",
      ref: "odoo:4512",
    });
  });

  it("writes outside the caller's transaction", async () => {
    const callerTx = { insert: vi.fn() };
    await executeTool("calculator", { expression: "1" }, { ...CTX, tx: callerTx as never });
    expect(callerTx.insert).not.toHaveBeenCalled();
    expect(h.withWorkspaceTx).toHaveBeenCalledWith("ws_1", expect.any(Function));
    expect(h.rows).toHaveLength(1);
  });

  it("a failing recorder does not change the tool's result", async () => {
    h.withWorkspaceTx.mockRejectedValue(new Error("relation tool_call does not exist"));
    const result = { ok: true };
    h.runAction.mockResolvedValue(result);
    expect(await executeTool("odoo_get_task", { id: 4512 }, CTX)).toBe(result);
    expect(h.log).toHaveBeenCalledWith("warn", "tool_call.record_failed", {
      tool: "odoo_get_task",
      error: "relation tool_call does not exist",
    });
  });

  it("a failing recorder does not change the tool's error", async () => {
    h.withWorkspaceTx.mockRejectedValue(new Error("pool closed"));
    const boom = new Error("odoo down");
    h.runAction.mockRejectedValue(boom);
    await expect(executeTool("odoo_get_task", { id: 4512 }, CTX)).rejects.toBe(boom);
  });
});
