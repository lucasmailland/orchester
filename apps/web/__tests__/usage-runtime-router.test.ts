// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type RunAgentParams } from "@/lib/agent-runtime";
import { handleInbound, handleInboundStream } from "@/lib/channels/router";
import { calculateChatCostUsd, calculateCostUsd } from "@/lib/pricing";

// What the agent runtime and the channel router charge for a turn: input and
// output at their own price when the provider reports the split, today's rate
// when it does not.

const MODEL = "bedrock:us.anthropic.claude-sonnet-4-6";
const h = vi.hoisted(() => {
  const agent = {
    id: "agent_test",
    name: "Support",
    kind: "conversational" as const,
    flowId: null,
    systemPrompt: "Work the case",
    model: "bedrock:us.anthropic.claude-sonnet-4-6",
    temperature: "0",
    maxTokens: 100,
    variables: {},
    tools: ["probe"] as string[] | null,
    status: "active",
    responseFormat: "text" as const,
    maxTurns: 20 as number | null,
    config: {} as Record<string, unknown> | null,
    fallback: null,
  };
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const rows = (table: string): unknown[] => {
    if (table === "agents") return [agent];
    if (table === "channels")
      return [{ id: "channel_test", status: "active", agentId: agent.id, type: "widget" }];
    if (table === "conversations")
      return [{ id: "conversation_test", status: "open", messageCount: 0, agentId: agent.id }];
    if (table === "messages") return [{ role: "user", content: "go" }];
    if (table === "workspaces") return [{ id: "ws_test", status: "active" }];
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
      values: async (values: Record<string, unknown>) => {
        inserts.push({ table: table.key, values });
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return {
    agent,
    inserts,
    tx,
    llm: vi.fn(),
    stream: vi.fn(),
    tool: vi.fn(),
    usage: vi.fn(),
    messageCost: vi.fn(),
    compact: vi.fn(),
  };
});
vi.mock("@orchester/db", () => ({
  getDb: () => ({ ...h.tx, transaction: async (fn: (tx: unknown) => unknown) => fn(h.tx) }),
  schema: Object.fromEntries(
    ["agents", "flows", "channels", "conversations", "messages", "usageEvents", "workspaces"].map(
      (key) => [key, { key }]
    )
  ),
}));
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: async (_id: string, fn: (tx: unknown) => unknown) => fn(h.tx),
}));
vi.mock("@/lib/llm-call", () => ({ llmCall: h.llm, llmStream: h.stream }));
const probe = { name: "probe", description: "Probe", inputSchema: { type: "object" } };
vi.mock("@/lib/tools", () => ({
  executeTool: h.tool,
  getToolDefinitions: () => [probe],
  resolveToolDefinitions: async () => [probe],
  toolEffect: async () => "read",
}));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/ai/run", async (original) => ({
  ...(await original<typeof import("@/lib/ai/run")>()),
  recordAiUsage: h.usage,
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
vi.mock("@/lib/memory-compaction", () => ({ compactHistory: h.compact }));
vi.mock("@/lib/employee-budget", () => ({
  checkEmployeeBudget: async () => ({ allowed: true }),
  recordMessageCost: h.messageCost,
}));
vi.mock("@/lib/billing/quotas", () => ({ checkQuota: async () => ({ allowed: true }) }));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

const BARE = "us.anthropic.claude-sonnet-4-6";
const toolTurn = {
  content: "",
  model: BARE,
  tokensIn: 1_000,
  tokensOut: 200,
  tokensUsed: 1_200,
  toolCalls: [{ id: "t1", name: "probe", input: {} }],
};
const answer = { content: "done", model: BARE, tokensIn: 1_300, tokensOut: 100, tokensUsed: 1_400 };

const written = (table: string) => h.inserts.filter((w) => w.table === table).map((w) => w.values);
const channel = () =>
  handleInbound("ws_test", { channelId: "channel_test", externalId: "x", text: "go" });

beforeEach(() => {
  vi.clearAllMocks();
  h.inserts.length = 0;
  h.agent.tools = ["probe"];
  h.tool.mockResolvedValue({ ok: true });
  h.compact.mockResolvedValue([{ role: "user", content: "go" }]);
  h.llm.mockReset().mockResolvedValueOnce(toolTurn).mockResolvedValueOnce(answer);
});

describe("agent runtime usage", () => {
  const runtime = () =>
    runAgent({
      workspaceId: "ws_test",
      agent: h.agent,
      messages: [{ role: "user", content: "go" }],
    } as RunAgentParams);

  it("charges input and output at their own price on every call", async () => {
    await runtime();
    expect(h.usage).toHaveBeenCalledTimes(2);
    for (const [i, res] of [toolTurn, answer].entries()) {
      expect(h.usage.mock.calls[i]![0]).toMatchObject({
        workspaceId: "ws_test",
        capability: "chat",
        model: BARE,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        tokensTotal: res.tokensUsed,
        costUsd: calculateChatCostUsd(BARE, res.tokensIn, res.tokensOut),
      });
    }
  });

  it("still charges everything as output when the provider gives no split", async () => {
    h.llm.mockReset().mockResolvedValue({ content: "x", model: BARE, tokensUsed: 500 });
    await runtime();
    expect(h.usage.mock.calls[0]![0]).toMatchObject({
      tokensIn: 0,
      tokensOut: 500,
      costUsd: calculateChatCostUsd(BARE, 0, 500),
    });
  });
});

describe("channel router usage", () => {
  it("prices the message and the usage event with the turn's real split", async () => {
    await channel();
    const cost = calculateChatCostUsd(MODEL, 2_300, 300);
    // The split must matter, or this test proves nothing.
    expect(cost).not.toBe(calculateCostUsd(MODEL, 2_600));
    const assistant = written("messages").find((m) => m.role === "assistant");
    expect(assistant).toMatchObject({ tokensUsed: 2_600, costUsd: String(cost), model: MODEL });
    expect(h.messageCost).toHaveBeenCalledWith(
      expect.objectContaining({ tokensUsed: 2_600, costUsd: cost }),
      h.tx
    );
    expect(written("usageEvents")).toEqual([
      expect.objectContaining({
        kind: "agent_message",
        amount: 1,
        agentId: "agent_test",
        costUsd: String(cost),
        metadata: { tokens: 2_600, model: MODEL },
      }),
    ]);
  });

  it("meters a failed turn with the split of the calls it paid for", async () => {
    h.llm.mockReset().mockResolvedValueOnce(toolTurn).mockRejectedValueOnce(new Error("boom"));
    await expect(channel()).rejects.toThrow("boom");
    expect(written("usageEvents")).toEqual([
      expect.objectContaining({
        kind: "agent_message",
        amount: 1,
        costUsd: String(calculateChatCostUsd(MODEL, 1_000, 200)),
        metadata: expect.objectContaining({ tokens: 1_200, failed: true }),
      }),
    ]);
  });

  it("keeps today's rate for a call without a split", async () => {
    h.llm
      .mockReset()
      .mockResolvedValueOnce({ ...toolTurn, tokensIn: undefined, tokensOut: undefined })
      .mockResolvedValueOnce(answer);
    await channel();
    const cost = calculateCostUsd(MODEL, 2_600);
    expect(written("usageEvents")[0]).toMatchObject({ costUsd: String(cost) });
  });

  it("keeps today's rate for a streamed reply, which reports no split", async () => {
    h.agent.tools = [];
    h.stream.mockImplementation(async function* () {
      yield { type: "text", delta: "hi" };
      yield { type: "done", tokensUsed: 500, model: BARE };
    });
    const chunks = [];
    for await (const c of handleInboundStream("ws_test", {
      channelId: "channel_test",
      externalId: "x",
      text: "go",
    }))
      chunks.push(c);
    expect(chunks.at(-1)).toMatchObject({ type: "done", tokensUsed: 500 });
    expect(written("usageEvents")).toEqual([
      expect.objectContaining({
        kind: "agent_message",
        amount: 1,
        costUsd: String(calculateCostUsd(MODEL, 500)),
      }),
    ]);
  });
});
