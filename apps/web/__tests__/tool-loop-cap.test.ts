// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type RunAgentParams } from "@/lib/agent-runtime";
import { handleInbound } from "@/lib/channels/router";
import { executeFlow } from "@/lib/flow-engine";
import type { ChatMessage } from "@/lib/llm-call";
import { outputLimitRefusal } from "@/lib/ai/output-limit";
import { handleMnemosyneRemember } from "@/lib/agent-tools/mnemosyne-remember";
import { mcpHashedToolName } from "@/lib/integrations/mcp-policy";
import { recordToolCall } from "@/lib/activity/tool-calls";
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
vi.mock("@/lib/activity/tool-calls", async (original) => ({
  ...(await original<typeof import("@/lib/activity/tool-calls")>()),
  recordToolCall: vi.fn(),
}));

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
    h.toolDefs = [probe, { ...probe, name: "agent_handoff" }];
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

describe.each(paths)("%s, reply cut at the output limit", (_name, go) => {
  it("runs none of its tool calls and tells the model why", async () => {
    h.llm
      .mockResolvedValueOnce({
        content: "",
        model: "gpt-4o",
        tokensUsed: 2,
        truncated: true,
        toolCalls: [
          { id: "t1", name: "probe", input: { q: "complete" } },
          { id: "t2", name: "probe", input: {} },
        ],
      })
      .mockResolvedValueOnce({ content: "done", model: "gpt-4o", tokensUsed: 2 });
    await go();
    expect(h.tool).not.toHaveBeenCalled();
    expect(h.llm).toHaveBeenCalledTimes(2);
    const messages = (h.llm.mock.calls[1]![0] as { messages: ChatMessage[] }).messages;
    const [assistant, tool] = messages.slice(-2);
    expect(assistant?.toolCalls?.map((tc) => tc.id)).toEqual(["t1", "t2"]);
    expect(tool?.toolResults).toEqual([
      { id: "t1", name: "probe", input: { q: "complete" }, error: outputLimitRefusal(100) },
      { id: "t2", name: "probe", input: {}, error: outputLimitRefusal(100) },
    ]);
  });

  it("runs the calls of the next, complete reply", async () => {
    h.llm
      .mockResolvedValueOnce({
        content: "",
        model: "gpt-4o",
        tokensUsed: 2,
        truncated: true,
        toolCalls: [{ id: "t1", name: "probe", input: {} }],
      })
      .mockResolvedValueOnce({
        content: "",
        model: "gpt-4o",
        tokensUsed: 2,
        toolCalls: [{ id: "t2", name: "probe", input: { q: "short" } }],
      })
      .mockResolvedValueOnce({ content: "done", model: "gpt-4o", tokensUsed: 2 });
    await go();
    expect(h.tool).toHaveBeenCalledTimes(1);
    expect(h.tool.mock.calls[0]![0]).toBe("probe");
    expect(h.tool.mock.calls[0]![1]).toEqual({ q: "short" });
  });
});

describe.each(paths)("%s, offered tools", (_name, go) => {
  const complete = { content: "done", model: "gpt-4o", tokensUsed: 2 };
  const request = (name: string) => ({
    ...complete,
    content: "",
    toolCalls: [{ id: "requested", name, input: {} }],
  });
  const feedback = () => {
    const messages = h.llm.mock.calls[1]![0].messages as ChatMessage[];
    return messages.findLast((m) => m.role === "tool")?.toolResults;
  };

  it.each(_name === "flow agent node" ? [false] : [false, true])(
    "returns an error for an unoffered tool (empty=%s)",
    async (empty) => {
      const name = "odoo_post_task_note";
      if (empty) {
        h.agent.tools = [];
        h.toolDefs = [];
      }
      h.llm.mockResolvedValueOnce(request(name)).mockResolvedValueOnce(complete);
      await go();
      expect(h.tool).not.toHaveBeenCalled();
      expect(feedback()).toEqual([
        {
          id: "requested",
          name,
          input: {},
          error: `Tool "${name}" is not available for this agent`,
        },
      ]);
      expect(feedback()![0]!.error).not.toContain("probe");
      expect(recordToolCall).toHaveBeenCalledTimes(1);
      expect(recordToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws_test",
          source:
            _name === "agent runtime"
              ? "api"
              : _name === "conversational loop"
                ? "channel"
                : "flow_agent",
          agentId: "agent_test",
          tool: name,
          input: {},
          startedAt: expect.any(Date),
          durationMs: 0,
          thrown: new Error(`Tool "${name}" is not available for this agent`),
          ...(_name === "conversational loop"
            ? { conversationId: "conversation_test", channelId: "channel_test" }
            : {}),
          ...(_name === "flow agent node"
            ? { flowId: "flow_test", flowRunId: expect.any(String), nodeId: "a" }
            : {}),
        })
      );
    }
  );

  it("uses the offered definitions even when the raw selection contains the requested name", async () => {
    const name = "odoo_post_task_note";
    h.agent.tools = ["probe", name];
    h.toolDefs = [probe];
    h.llm.mockResolvedValueOnce(request(name)).mockResolvedValueOnce(complete);
    await go();
    expect(h.tool).not.toHaveBeenCalled();
    expect(feedback()![0]?.error).toBe(`Tool "${name}" is not available for this agent`);
  });

  it.each(["mcp__other__read", mcpHashedToolName("other", "read")])(
    "refuses another agent's MCP tool %s before execution",
    async (name) => {
      h.toolDefs = [
        { ...probe, name: "mcp__docs__read", integrationId: "docs", remoteName: "read" },
      ];
      h.llm.mockResolvedValueOnce(request(name)).mockResolvedValueOnce(complete);
      await go();
      expect(h.tool).not.toHaveBeenCalled();
      expect(feedback()![0]?.error).toBe(`Tool "${name}" is not available for this agent`);
      expect(feedback()![0]?.error).not.toContain("mcp__docs__read");
    }
  );

  it("runs a configured tool and passes the offered definitions to execution", async () => {
    h.llm.mockResolvedValueOnce(request("probe")).mockResolvedValueOnce(complete);
    await go();
    expect(h.tool).toHaveBeenCalledTimes(1);
    expect(h.tool).toHaveBeenCalledWith(
      "probe",
      {},
      expect.objectContaining({ offeredTools: [probe] })
    );
    expect(feedback()![0]?.error).toBeUndefined();
    expect(recordToolCall).not.toHaveBeenCalled();
  });

  it.each(["knowledge_search", "memory_set", "memory_get", "agent_team_list"])(
    "runs %s when it is present in the offered definitions",
    async (name) => {
      h.toolDefs = [{ ...probe, name }];
      h.llm.mockResolvedValueOnce(request(name)).mockResolvedValueOnce(complete);
      await go();
      expect(h.agent.tools).not.toContain(name);
      expect(h.tool).toHaveBeenCalledTimes(1);
      expect(h.tool.mock.calls[0]![0]).toBe(name);
      expect(feedback()![0]?.error).toBeUndefined();
    }
  );

  it.each([
    ["mcp__docs__read", mcpHashedToolName("docs", "read")],
    [mcpHashedToolName("docs", "read"), "mcp__docs__read"],
  ])("accepts the alias %s of the offered MCP tool %s", async (requested, offered) => {
    h.toolDefs = [
      { ...probe, name: offered, integrationId: "docs", remoteName: "read", effect: "read" },
    ];
    h.llm.mockResolvedValueOnce(request(requested)).mockResolvedValueOnce(complete);
    await go();
    expect(h.tool).toHaveBeenCalledTimes(1);
    expect(h.tool.mock.calls[0]![0]).toBe(requested);
    expect(feedback()![0]?.error).toBeUndefined();
  });
});

describe("dedicated and conversational tools", () => {
  const complete = { content: "done", model: "gpt-4o", tokensUsed: 2 };
  const remember = { id: "remember", name: "mnemosyne_remember", input: {} };

  it.each([false, true])(
    "includes memory guidance only when remember is offered (%s)",
    async (offered) => {
      h.toolDefs = offered ? [probe, { ...probe, name: "mnemosyne_remember" }] : [probe];
      h.llm.mockResolvedValue(complete);
      await runtime();
      const prompt = h.llm.mock.calls[0]![0].systemPrompt as string;
      const guidance = "If a fact relevant to the user appears below in <recalled-memory>";
      expect(prompt.includes(guidance)).toBe(offered);
      expect(
        prompt.includes("call the `mnemosyne_remember` tool with kind/subject/statement.")
      ).toBe(offered);
      expect(prompt).toContain("\n\n---\n1.0.0\n---\n");
    }
  );

  it("records a test chat refusal with its conversation context", async () => {
    h.llm
      .mockResolvedValueOnce({ ...complete, toolCalls: [remember] })
      .mockResolvedValueOnce(complete);
    await runAgent({
      workspaceId: "ws_test",
      agent: h.agent,
      messages: [{ role: "user", content: "go" }],
      testChat: true,
      conversationId: "conversation_test",
    } as RunAgentParams);
    expect(h.tool).not.toHaveBeenCalled();
    expect(handleMnemosyneRemember).not.toHaveBeenCalled();
    expect(recordToolCall).toHaveBeenCalledTimes(1);
    expect(recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "test_chat",
        agentId: "agent_test",
        conversationId: "conversation_test",
        tool: "mnemosyne_remember",
        durationMs: 0,
        thrown: new Error('Tool "mnemosyne_remember" is not available for this agent'),
      })
    );
  });

  it("does not call the dedicated remember handler when its definition was not offered", async () => {
    h.llm
      .mockResolvedValueOnce({ ...complete, toolCalls: [remember] })
      .mockResolvedValueOnce(complete);
    const result = await runtime();
    expect(handleMnemosyneRemember).not.toHaveBeenCalled();
    expect(h.tool).not.toHaveBeenCalled();
    expect(recordToolCall).toHaveBeenCalledTimes(1);
    expect(recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "api",
        agentId: "agent_test",
        tool: "mnemosyne_remember",
        durationMs: 0,
        thrown: new Error('Tool "mnemosyne_remember" is not available for this agent'),
      })
    );
    expect(result.toolCalls?.[0]?.error).toBe(
      'Tool "mnemosyne_remember" is not available for this agent'
    );
    const messages = h.llm.mock.calls[1]![0].messages as ChatMessage[];
    expect(messages.at(-1)?.toolResults).toEqual([
      { ...remember, error: 'Tool "mnemosyne_remember" is not available for this agent' },
    ]);
  });

  it("runs the dedicated remember handler when its definition was offered", async () => {
    h.toolDefs = [{ ...probe, name: "mnemosyne_remember" }];
    vi.mocked(handleMnemosyneRemember).mockResolvedValue({ ok: true } as never);
    h.llm
      .mockResolvedValueOnce({ ...complete, toolCalls: [remember] })
      .mockResolvedValueOnce(complete);
    await runtime();
    expect(h.agent.tools).not.toContain("mnemosyne_remember");
    expect(handleMnemosyneRemember).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ workspaceId: "ws_test", agentId: "agent_test" })
    );
    expect(h.tool).not.toHaveBeenCalled();
  });

  it.each([runtime, channel])("runs an offered handoff in a conversational path", async (go) => {
    h.toolDefs = [{ ...probe, name: "agent_handoff" }];
    h.tool.mockResolvedValue({ simulated: true });
    h.llm
      .mockResolvedValueOnce({
        ...complete,
        toolCalls: [{ id: "handoff", name: "agent_handoff", input: {} }],
      })
      .mockResolvedValueOnce(complete);
    await go();
    expect(h.tool).toHaveBeenCalledTimes(1);
    expect(h.tool.mock.calls[0]![0]).toBe("agent_handoff");
  });

  it("refuses handoff in a flow even when it is in the agent's selection", async () => {
    h.agent.tools = ["agent_handoff", "probe"];
    h.toolDefs = [probe, { ...probe, name: "agent_handoff" }];
    h.llm
      .mockResolvedValueOnce({
        ...complete,
        toolCalls: [{ id: "handoff", name: "agent_handoff", input: {} }],
      })
      .mockResolvedValueOnce(complete);
    await flow();
    expect(h.tool).not.toHaveBeenCalled();
    const messages = h.llm.mock.calls[1]![0].messages as ChatMessage[];
    expect(messages.at(-1)?.toolResults?.[0]?.error).toBe(
      'Tool "agent_handoff" is not available for this agent'
    );
  });

  it("checks the next channel call against the new agent's definitions after handoff", async () => {
    h.toolDefs = [probe, { ...probe, name: "agent_handoff" }];
    h.tool.mockImplementationOnce(async () => {
      h.state.handoffTo = { ...h.agent, id: "agent_next", tools: ["knowledge_search"] };
      h.toolDefs = [{ ...probe, name: "knowledge_search" }];
      return { ok: true };
    });
    h.llm
      .mockResolvedValueOnce({
        ...complete,
        toolCalls: [{ id: "handoff", name: "agent_handoff", input: {} }],
      })
      .mockResolvedValueOnce({ ...complete, toolCalls: [{ id: "old", name: "probe", input: {} }] })
      .mockResolvedValueOnce(complete);
    await channel();
    expect(h.tool).toHaveBeenCalledTimes(1);
    expect(h.llm.mock.calls[1]![0].tools.map((tool: { name: string }) => tool.name)).toEqual([
      "knowledge_search",
    ]);
    const messages = h.llm.mock.calls[2]![0].messages as ChatMessage[];
    expect(messages.at(-1)?.toolResults?.[0]?.error).toBe(
      'Tool "probe" is not available for this agent'
    );
  });
});
