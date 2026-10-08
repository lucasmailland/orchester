import { describe, it, expect, vi, beforeEach } from "vitest";

const enqueueFlowRun = vi.hoisted(() => vi.fn(async () => ({ runId: "r1", status: "pending" })));
vi.mock("@/lib/flow-engine", () => ({ enqueueFlowRun }));
vi.mock("@/lib/mnemo/client", () => ({ getMnemoClient: vi.fn() }));

const auth = { workspaceId: "ws_a", keyId: "key_1", scopes: [] as string[] };

beforeEach(() => enqueueFlowRun.mockClear());

describe("MCP run_flow dryRun", async () => {
  const { callMcpTool, listMcpTools } = await import("@/lib/mcp/server");

  it("declares dryRun in its schema", () => {
    const tool = listMcpTools().find((t) => t.name === "run_flow");
    expect(JSON.stringify(tool)).toContain("dryRun");
  });

  it("passes dryRun through to the engine", async () => {
    await callMcpTool("run_flow", { flowId: "f1", dryRun: true }, auth);
    expect(enqueueFlowRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it("does not dry-run unless asked", async () => {
    await callMcpTool("run_flow", { flowId: "f1" }, auth);
    const arg = (enqueueFlowRun.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg.dryRun).toBeUndefined();
  });
});
