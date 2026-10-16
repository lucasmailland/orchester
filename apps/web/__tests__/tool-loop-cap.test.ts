// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type RunAgentParams } from "@/lib/agent-runtime";
import { handleInbound } from "@/lib/channels/router";
import { executeFlow } from "@/lib/flow-engine";
import {
  resolveMaxToolCalls,
  mergeAgentConfig,
  DEFAULT_MAX_TOOL_CALLS,
} from "@/lib/agents/tool-call-cap";

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
  // The agent a conversation is handed off to; until then every agent read finds `agent`.
  const state = { handoffTo: null as null | typeof agent };
  const rows = (table: string): unknown[] => {
    if (table === "agents") return [state.handoffTo ?? agent];
    if (table === "flows") return [flow];
    if (table === "channels")
      return [{ id: "channel_test", status: "active", agentId: agent.id, type: "widget" }];
    if (table === "conversations")
      return [
        {
          id: "conversation_test",
          status: "open",
          messageCount: 0,
          agentId: state.handoffTo?.id ?? agent.id,
        },
      ];
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
  return {
    agent,
    flow,
    state,
    tx,
    llm: vi.fn(),
    tool: vi.fn(),
    spend: vi.fn(),
    usage: vi.fn(),
    // Tool definitions the agent resolves to; null means the one `probe` tool.
    toolDefs: null as unknown[] | null,
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
const probe = { name: "probe", description: "Probe", inputSchema: { type: "object" } };
vi.mock("@/lib/tools", () => ({
  executeTool: h.tool,
  getToolDefinitions: () => [probe],
  resolveToolDefinitions: async () => h.toolDefs ?? [probe],
  toolEffect: async () => "read",
}));
vi.mock("@/lib/integrations/store", () => ({ runIntegrationAction: h.tool }));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: h.spend }));
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

const runtime = () =>
  runAgent({
    workspaceId: "ws_test",
    agent: h.agent,
    messages: [{ role: "user", content: "go" }],
  } as RunAgentParams);
const channel = () =>
  handleInbound("ws_test", { channelId: "channel_test", externalId: "x", text: "go" });
const flow = async () => {
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
  return executeFlow({
    flowId: "flow_test",
    workspaceId: "ws_test",
    triggerSource: "test",
    input: { message: "go" },
  });
};
// The conversational loop meters once per turn when it persists the reply (as before);
// the other two meter every call.
const paths: Array<[string, () => Promise<unknown>, boolean]> = [
  ["agent runtime", runtime, true],
  ["conversational loop", channel, false],
  ["flow agent node", flow, true],
];

beforeEach(() => {
  vi.clearAllMocks();
  h.agent.config = {};
  h.agent.maxTurns = 20;
  h.agent.tools = ["probe"];
  h.toolDefs = null;
  h.state.handoffTo = null;
  h.tool.mockResolvedValue({ ok: true });
  // The model never stops asking for the tool, so the cap is what ends the loop.
  h.llm.mockResolvedValue({
    content: "",
    model: "gpt-4o",
    tokensUsed: 2,
    toolCalls: [{ id: "t1", name: "probe", input: {} }],
  });
});

describe("resolveMaxToolCalls", () => {
  it.each([undefined, null, {}, "x", { maxToolCalls: "8" }, { maxToolCalls: NaN }])(
    "defaults to 5 for %j",
    (config) => {
      expect(resolveMaxToolCalls(config)).toBe(DEFAULT_MAX_TOOL_CALLS);
      expect(DEFAULT_MAX_TOOL_CALLS).toBe(5);
    }
  );
  it("uses a stored value and clamps a corrupt one", () => {
    expect(resolveMaxToolCalls({ maxToolCalls: 8 })).toBe(8);
    expect(resolveMaxToolCalls({ maxToolCalls: 999 })).toBe(15);
    expect(resolveMaxToolCalls({ maxToolCalls: -3 })).toBe(1);
    expect(resolveMaxToolCalls({ maxToolCalls: 0 })).toBe(1);
    expect(resolveMaxToolCalls({ maxToolCalls: 7.9 })).toBe(7);
    expect(resolveMaxToolCalls({ maxToolCalls: Infinity })).toBe(5);
  });
  it("merges a patch keeping unknown keys", () => {
    expect(mergeAgentConfig({ knowledgeBaseIds: ["k"], a: 1 }, { maxToolCalls: 8 })).toEqual({
      knowledgeBaseIds: ["k"],
      a: 1,
      maxToolCalls: 8,
    });
    expect(mergeAgentConfig(null, { maxToolCalls: 8 })).toEqual({ maxToolCalls: 8 });
  });
});

describe.each(paths)("%s and the prompt cache", (_name, go) => {
  it("caches the agent's fixed prompt and the conversation on every call", async () => {
    await go();
    expect(h.llm).toHaveBeenCalledTimes(5);
    for (const [p] of h.llm.mock.calls) {
      expect(p.cacheMessages).toBe(true);
      expect(p.systemPromptCacheBoundary).toBeGreaterThan(0);
      expect(p.systemPrompt.slice(0, p.systemPromptCacheBoundary)).toContain("Work the case");
    }
  });
  it("leaves the conversation uncached when the agent has no tools", async () => {
    h.agent.tools = [];
    h.toolDefs = [];
    h.llm.mockResolvedValue({ content: "done", model: "gpt-4o", tokensUsed: 2 });
    await go();
    expect(h.llm).toHaveBeenCalledTimes(1);
    expect(h.llm.mock.calls[0]![0]).not.toHaveProperty("cacheMessages");
  });
});

describe("what the system prompt checkpoint covers", () => {
  it("the conversational loop caches only the agent's prompt, not the context after it", async () => {
    await channel();
    const [p] = h.llm.mock.calls[0]!;
    expect(p.systemPrompt.slice(0, p.systemPromptCacheBoundary)).toBe("Work the case");
    expect(p.systemPrompt.length).toBeGreaterThan(p.systemPromptCacheBoundary);
  });
  it("after a handoff, the conversational loop caches the new agent's prompt", async () => {
    h.llm.mockResolvedValueOnce({
      content: "",
      model: "gpt-4o",
      tokensUsed: 2,
      toolCalls: [{ id: "h1", name: "agent_handoff", input: {} }],
    });
    h.tool.mockImplementationOnce(async () => {
      h.state.handoffTo = {
        ...h.agent,
        id: "agent_billing",
        systemPrompt: "Take the invoices and nothing else",
      };
      return { ok: true };
    });
    await channel();
    const [before] = h.llm.mock.calls[0]!;
    const [after] = h.llm.mock.calls[1]!;
    expect(before.systemPrompt.slice(0, before.systemPromptCacheBoundary)).toBe("Work the case");
    expect(after.systemPrompt.slice(0, after.systemPromptCacheBoundary)).toBe(
      "Take the invoices and nothing else"
    );
  });
  it("the flow agent node caches its whole system prompt, which never changes", async () => {
    await flow();
    const [p] = h.llm.mock.calls[0]!;
    expect(p.systemPromptCacheBoundary).toBe(p.systemPrompt.length);
  });
});

describe.each(paths)("%s", (_name, go, meteredPerCall) => {
  it("keeps today's 5 model calls by default", async () => {
    await go();
    expect(h.llm).toHaveBeenCalledTimes(5);
  });
  it("gives an agent configured with 8 eight calls, each guarded and metered", async () => {
    h.agent.config = { maxToolCalls: 8, other: true };
    await go();
    expect(h.llm).toHaveBeenCalledTimes(8);
    expect(h.spend).toHaveBeenCalledTimes(8);
    if (meteredPerCall) expect(h.usage).toHaveBeenCalledTimes(8);
  });
  it("clamps a corrupt stored value to 15", async () => {
    h.agent.config = { maxToolCalls: 500 };
    await go();
    expect(h.llm).toHaveBeenCalledTimes(15);
  });
  it("a lower value than the default lowers the cap", async () => {
    h.agent.config = { maxToolCalls: 2 };
    await go();
    expect(h.llm).toHaveBeenCalledTimes(2);
  });
});
