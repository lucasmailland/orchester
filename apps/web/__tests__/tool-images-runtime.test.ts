// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type RunAgentParams } from "@/lib/agent-runtime";
import { handleInbound } from "@/lib/channels/router";
import { executeFlow, enqueueFlowRun, resumePausedFlow } from "@/lib/flow-engine";
import { enqueue } from "@/lib/queue";
import type { LlmCallParams } from "@/lib/llm-call";
const h = vi.hoisted(() => {
  const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  const agent = {
    id: "agent_test",
    name: "Support",
    kind: "conversational" as const,
    flowId: null,
    systemPrompt: "Inspect evidence",
    model: "openai:gpt-4o",
    temperature: "0",
    maxTokens: 100,
    variables: {},
    tools: ["screens"],
    status: "active",
    responseFormat: "text" as const,
    maxTurns: 5,
  };
  const flow = { id: "flow_test", nodes: [] as unknown[], edges: [] as unknown[], variables: {} };
  const rows = (table: string): unknown[] => {
    if (table === "agents") return [agent];
    if (table === "flows") return [flow];
    if (table === "channels")
      return [{ id: "channel_test", status: "active", agentId: agent.id, type: "widget" }];
    if (table === "conversations")
      return [{ id: "conversation_test", status: "open", messageCount: 0 }];
    if (table === "messages") return [{ role: "user", content: "Inspect evidence" }];
    return [];
  };
  const tx = {
    execute: vi.fn(async () => []),
    select: () => ({
      from: (table: { key: string }) => {
        const result = rows(table.key);
        const query = {
          where: () => query,
          orderBy: () => query,
          limit: async () => result,
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
        };
        return query;
      },
    }),
    insert: (table: { key: string }) => ({
      values: async (value: Record<string, unknown>) => {
        writes.push({ table: table.key, value });
      },
    }),
    update: (table: { key: string }) => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          writes.push({ table: table.key, value });
        },
      }),
    }),
  };
  return {
    writes,
    agent,
    flow,
    tx,
    llm: vi.fn(),
    tool: vi.fn(),
    usage: vi.fn(),
    logs: vi.fn(),
    audit: vi.fn(),
  };
});
vi.mock("@orchester/db", () => ({
  getDb: () => ({ ...h.tx, transaction: async (fn: (tx: unknown) => unknown) => fn(h.tx) }),
  schema: Object.fromEntries(
    [
      "agents",
      "flows",
      "flowRuns",
      "flowRunSteps",
      "channels",
      "conversations",
      "messages",
      "usageEvents",
    ].map((key) => [key, { key }])
  ),
}));
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: async (_id: string, fn: (tx: unknown) => unknown) => fn(h.tx),
}));
vi.mock("@/lib/llm-call", () => ({ llmCall: h.llm }));
const screensTool = {
  name: "screens",
  description: "Screenshots",
  inputSchema: { type: "object" },
};
vi.mock("@/lib/tools", () => ({
  executeTool: h.tool,
  getToolDefinitions: () => [screensTool],
  resolveToolDefinitions: async () => [screensTool],
  toolEffect: async () => "read",
}));
vi.mock("@/lib/integrations/store", () => ({ runIntegrationAction: h.tool }));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({
  recordAiUsage: h.usage,
  chargeFor: () => ({ tokensIn: 1, tokensOut: 1, tokensTotal: 2, costUsd: 0 }),
}));
vi.mock("@/lib/policy/agent-memory", () => ({
  getAgentMemoryPolicy: async () => ({ enabled: false }),
}));
vi.mock("@/lib/mnemo/recall", () => ({ recallForWorkspace: async () => ({ hits: [] }) }));
vi.mock("@/lib/agent-tools/mnemosyne-remember", () => ({ handleMnemosyneRemember: vi.fn() }));
vi.mock("@/lib/memory", () => ({
  getRelevantMemories: async () => [],
  formatMemoriesAsPromptBlock: () => "",
}));
vi.mock("@/lib/memory-compaction", () => ({
  compactHistory: async () => [{ role: "user", content: "Inspect evidence" }],
}));
vi.mock("@/lib/employee-budget", () => ({
  checkEmployeeBudget: async () => ({ allowed: true }),
  recordMessageCost: vi.fn(),
}));
vi.mock("@/lib/billing/quotas", () => ({ checkQuota: async () => ({ allowed: true }) }));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: h.logs }));
vi.mock("@/lib/audit", () => ({ logAudit: h.audit }));
const base64 = Buffer.from("private screenshot evidence").toString("base64");
const output = {
  text: "Screenshot evidence",
  images: [{ name: "screen.png", mediaType: "image/png", base64 }],
};
const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  label: id,
  position: { x: 0, y: 0 },
});
const runFlow = async (
  nodes: unknown[],
  input: Record<string, unknown> = { message: "inspect" }
) => {
  h.flow.nodes = nodes;
  h.flow.edges = nodes.slice(1).map((_, i) => ({
    id: `e${i}`,
    source: (nodes[i] as { id: string }).id,
    target: (nodes[i + 1] as { id: string }).id,
  }));
  return executeFlow({ flowId: "flow_test", workspaceId: "ws_test", triggerSource: "test", input });
};
function liveImages() {
  const request = h.llm.mock.calls[1]?.[0] as LlmCallParams | undefined;
  expect(request).toBeDefined();
  const result = request!.messages.find((m) => m.role === "tool")!.toolResults![0]!.output;
  expect(result).toMatchObject({
    images: output.images,
    text: expect.stringContaining("<untrusted_context"),
  });
  expect((result as { text: string }).text).not.toContain(base64);
}
function safe(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(base64);
}
beforeEach(() => {
  vi.clearAllMocks();
  h.writes.length = 0;
  h.tool.mockResolvedValue(output);
  h.llm
    .mockResolvedValueOnce({
      content: "",
      model: "gpt-4o",
      tokensUsed: 2,
      toolCalls: [{ id: "t1", name: "screens", input: {} }],
    })
    .mockResolvedValue({ content: "I see the screenshot", model: "gpt-4o", tokensUsed: 2 });
});
describe("transient image evidence across runtime boundaries", () => {
  it("keeps agent model evidence but redacts returned tool history used by test-chat/MCP", async () => {
    const result = await runAgent({
      workspaceId: "ws_test",
      agent: h.agent,
      messages: [{ role: "user", content: "hello" }],
    } as RunAgentParams);
    liveImages();
    safe(result.toolCalls);
    expect(JSON.stringify(result.toolCalls)).toContain("[image: screen.png, 1 KB]");
    safe(h.usage.mock.calls);
    safe(h.logs.mock.calls);
    safe(h.audit.mock.calls);
  });
  it("keeps channel model evidence out of conversation messages and usage/audit logs", async () => {
    await handleInbound("ws_test", {
      channelId: "channel_test",
      externalId: "test",
      text: "Inspect evidence",
    });
    liveImages();
    expect(h.writes.filter((w) => w.table === "messages")).toHaveLength(2);
    safe(h.writes);
    safe(h.logs.mock.calls);
    safe(h.audit.mock.calls);
  });
  it("runs a flow agent tool loop, keeping evidence out of step output and billing", async () => {
    const result = await runFlow([
      node("t", "trigger"),
      node("a", "agent", { agentId: "agent_test" }),
    ]);
    expect(result.status).toBe("succeeded");
    liveImages();
    expect(h.usage).toHaveBeenCalledTimes(2);
    safe(h.writes);
    safe(h.logs.mock.calls);
    safe(h.usage.mock.calls);
  });
  it.each(["flowRunSteps", "flowRuns"])(
    "redacts integration results in %s output",
    async (table) => {
      await runFlow([
        node("t", "trigger"),
        node("i", "integration", { integrationId: "odoo::get_task_attachments" }),
        node("n", "trigger"),
      ]);
      const snapshots = h.writes.filter((w) => w.table === table && "output" in w.value);
      expect(snapshots.length).toBeGreaterThan(0);
      safe(snapshots);
      expect(JSON.stringify(snapshots)).toContain("[image: screen.png, 1 KB]");
    }
  );
  it("redacts subsequent step inputs", async () => {
    await runFlow([
      node("t", "trigger"),
      node("i", "integration", { integrationId: "odoo::get_task_attachments" }),
      node("n", "trigger"),
    ]);
    const input = h.writes.find((w) => w.table === "flowRunSteps" && w.value.nodeId === "n")!.value
      .input;
    safe(input);
    expect(JSON.stringify(input)).toContain("[image: screen.png, 1 KB]");
  });
  it("redacts initial run and step inputs", async () => {
    await runFlow([node("t", "trigger")], { evidence: output });
    const inputs = h.writes.filter((w) => "input" in w.value);
    expect(inputs).toHaveLength(2);
    safe(inputs);
  });
  it("redacts paused flow variables", async () => {
    const result = await runFlow([
      node("t", "trigger"),
      node("i", "integration", { integrationId: "odoo::get_task_attachments" }),
      node("p", "wait_human", { message: "Review" }),
    ]);
    expect(result.status).toBe("paused");
    const paused = h.writes.find((w) => "pausedVariables" in w.value);
    expect(paused).toBeDefined();
    safe(paused);
    expect(JSON.stringify(paused)).toContain("[image: screen.png, 1 KB]");
  });
});

it("redacts queued flow inputs in both run rows and job payloads", async () => {
  await enqueueFlowRun({
    flowId: "flow_test",
    workspaceId: "ws_test",
    triggerSource: "test",
    input: { evidence: output },
  });
  expect(h.writes.some((w) => w.table === "flowRuns")).toBe(true);
  safe(h.writes);
  safe(vi.mocked(enqueue).mock.calls);
});
it.each([false, true])("redacts resumed flow snapshots (pause again=%s)", async (pause) => {
  h.flow.nodes = [
    node("p", "wait_human"),
    node("n", pause ? "wait_human" : "trigger", { message: "Review" }),
  ];
  h.flow.edges = [{ id: "e", source: "p", target: "n" }];
  const result = await resumePausedFlow({
    runId: "run_test",
    flowId: "flow_test",
    workspaceId: "ws_test",
    fromNodeId: "p",
    variables: { evidence: output },
    decision: "aprobado",
  });
  expect(result.status).toBe(pause ? "paused" : "succeeded");
  safe(h.writes);
});
it("redacts a failed step's captured response body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(output, { status: 400 }))
  );
  try {
    const result = await runFlow([
      node("t", "trigger"),
      node("h", "http", { url: "https://example.com", failOnStatus: true }),
    ]);
    expect(result.status).toBe("failed");
    const failed = h.writes.find((w) => w.table === "flowRunSteps" && w.value.status === "failed");
    expect(failed).toBeDefined();
    safe(failed);
    safe(h.logs.mock.calls);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("redacts image bytes copied into a flow transform string", async () => {
  await runFlow([
    node("t", "trigger"),
    node("i", "integration", { integrationId: "odoo::get_task_attachments" }),
    node("x", "transform", { target: "copy", value: "Evidence: {{appResult}}" }),
  ]);
  safe(h.writes);
});
