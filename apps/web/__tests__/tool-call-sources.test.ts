// @vitest-environment node
// Every caller of executeTool says where the call came from, so the tool call
// log can tell a channel conversation from a test chat, a flow or the MCP server.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type RunAgentParams } from "@/lib/agent-runtime";
import { handleInbound } from "@/lib/channels/router";
import { executeFlow } from "@/lib/flow-engine";
import { callMcpTool } from "@/lib/mcp/server";

const h = vi.hoisted(() => {
  const agent = {
    id: "agent_test",
    name: "Support",
    kind: "conversational" as const,
    flowId: null,
    systemPrompt: "Work the case",
    model: "openai:gpt-4o",
    temperature: "0",
    maxTokens: 100,
    variables: {},
    tools: ["probe"],
    status: "active",
    responseFormat: "text" as const,
    maxTurns: 20 as number | null,
    config: {} as Record<string, unknown> | null,
    fallback: null,
  };
  const flow = { id: "flow_test", nodes: [] as unknown[], edges: [] as unknown[], variables: {} };
  const rows = (table: string): unknown[] => {
    if (table === "agents") return [agent];
    if (table === "flows") return [flow];
    if (table === "channels")
      return [{ id: "channel_test", status: "active", agentId: agent.id, type: "widget" }];
    if (table === "conversations")
      return [{ id: "conversation_test", status: "open", messageCount: 0 }];
    if (table === "messages") return [{ role: "user", content: "go" }];
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
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return { agent, flow, tx, llm: vi.fn(), tool: vi.fn() };
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
const probe = { name: "probe", description: "Probe", inputSchema: { type: "object" } };
vi.mock("@/lib/tools", () => ({
  executeTool: h.tool,
  getToolDefinitions: () => [probe],
  resolveToolDefinitions: async () => [probe],
  toolEffect: async () => "read",
}));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({
  recordAiUsage: vi.fn(),
  chargeFor: () => ({ tokensIn: 1, tokensOut: 1, tokensTotal: 2, costUsd: 0 }),
}));
vi.mock("@/lib/policy/agent-memory", () => ({
  getAgentMemoryPolicy: async () => ({ enabled: false }),
}));
vi.mock("@/lib/mnemo/recall", () => ({ recallForWorkspace: async () => ({ hits: [] }) }));
vi.mock("@/lib/mnemo/client", () => ({ getMnemoClient: vi.fn() }));
vi.mock("@/lib/agent-tools/mnemosyne-remember", () => ({ handleMnemosyneRemember: vi.fn() }));
vi.mock("@/lib/memory", () => ({
  getRelevantMemories: async () => [],
  formatMemoriesAsPromptBlock: () => "",
}));
vi.mock("@/lib/memory-compaction", () => ({
  compactHistory: async () => [{ role: "user", content: "go" }],
}));
vi.mock("@/lib/employee-budget", () => ({
  checkEmployeeBudget: async () => ({ allowed: true }),
  recordMessageCost: vi.fn(),
}));
vi.mock("@/lib/billing/quotas", () => ({ checkQuota: async () => ({ allowed: true }) }));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

const runtime = (extra: Partial<RunAgentParams> = {}) =>
  runAgent({
    workspaceId: "ws_test",
    agent: h.agent,
    messages: [{ role: "user", content: "go" }],
    ...extra,
  } as RunAgentParams);

/** The context of the one tool call the model asked for. */
const toolContext = () => {
  expect(h.tool).toHaveBeenCalledTimes(1);
  return h.tool.mock.calls[0]![2] as Record<string, unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.tool.mockResolvedValue({ ok: true });
  h.llm
    .mockResolvedValueOnce({
      content: "",
      model: "gpt-4o",
      tokensUsed: 2,
      toolCalls: [{ id: "t1", name: "probe", input: {} }],
    })
    .mockResolvedValue({ content: "done", model: "gpt-4o", tokensUsed: 2, toolCalls: [] });
});

describe("tool call source", () => {
  it("the agent runtime reports api", async () => {
    await runtime({ conversationId: "conversation_api" });
    expect(toolContext()).toMatchObject({
      source: "api",
      agentId: "agent_test",
      conversationId: "conversation_api",
    });
  });

  it("the agent runtime reports test_chat for the test chat", async () => {
    await runtime({ testChat: true });
    expect(toolContext()).toMatchObject({ source: "test_chat", agentId: "agent_test" });
  });

  it("a channel turn reports channel, with the channel and the conversation", async () => {
    await handleInbound("ws_test", { channelId: "channel_test", externalId: "x", text: "go" });
    expect(toolContext()).toMatchObject({
      source: "channel",
      channelId: "channel_test",
      conversationId: "conversation_test",
      agentId: "agent_test",
    });
  });

  it("a flow agent step reports flow_agent, with the flow, the run and the step", async () => {
    h.flow.nodes = [
      { id: "t", type: "trigger", config: {}, label: "t", position: { x: 0, y: 0 } },
      {
        id: "a",
        type: "agent",
        config: { agentId: "agent_test" },
        label: "a",
        position: { x: 0, y: 0 },
      },
    ];
    h.flow.edges = [{ id: "e", source: "t", target: "a" }];
    const r = await executeFlow({
      flowId: "flow_test",
      workspaceId: "ws_test",
      triggerSource: "test",
      input: { message: "go" },
    });
    expect(toolContext()).toMatchObject({
      source: "flow_agent",
      flowId: "flow_test",
      flowRunId: r.runId,
      nodeId: "a",
      agentId: "agent_test",
    });
  });

  it("the MCP server reports mcp_server", async () => {
    const out = await callMcpTool(
      "search_knowledge",
      { kbId: "kb_1", query: "vpn" },
      { workspaceId: "ws_test", keyId: "key_1", scopes: [] }
    );
    expect(out.isError).toBeUndefined();
    expect(h.tool.mock.calls[0]![0]).toBe("knowledge_search");
    expect(toolContext()).toMatchObject({ source: "mcp_server", workspaceId: "ws_test" });
  });
});
