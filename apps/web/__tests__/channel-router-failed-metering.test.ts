// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleInbound } from "@/lib/channels/router";
import { calculateCostUsd } from "@/lib/pricing";
const h2 = vi.hoisted(() => ({
  pending: [] as { table: string; values: Record<string, unknown> }[],
  committed: [] as { table: string; values: Record<string, unknown> }[],
}));
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
    insert: (table: { key: string }) => ({
      values: async (v: Record<string, unknown>) => {
        h2.pending.push({ table: table.key, values: v });
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return { agent, flow, tx, llm: vi.fn(), tool: vi.fn(), spend: vi.fn(), usage: vi.fn() };
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
// Like the real helper: writes of a transaction that throws are rolled back.
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: async (_id: string, fn: (tx: unknown) => unknown) => {
    const outer = h2.pending;
    h2.pending = [];
    try {
      const out = await fn(h.tx);
      h2.committed.push(...h2.pending);
      return out;
    } finally {
      h2.pending = outer;
    }
  },
}));
vi.mock("@/lib/llm-call", () => ({ llmCall: h.llm }));
const probe = { name: "probe", description: "Probe", inputSchema: { type: "object" } };
vi.mock("@/lib/tools", () => ({
  executeTool: h.tool,
  getToolDefinitions: () => [probe],
  resolveToolDefinitions: async () => [probe],
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

const channel = () =>
  handleInbound("ws_test", { channelId: "channel_test", externalId: "x", text: "go" });
const usageEvents = () =>
  h2.committed.filter((w) => w.table === "usageEvents").map((w) => w.values);
const toolTurn = {
  content: "",
  model: "gpt-4o",
  tokensUsed: 1000,
  toolCalls: [{ id: "t1", name: "probe", input: {} }],
};

beforeEach(() => {
  vi.clearAllMocks();
  h2.pending = [];
  h2.committed = [];
  h.agent.config = {};
  h.tool.mockResolvedValue({ ok: true });
});

describe("channel turn usage metering", () => {
  it("records exactly one event on success", async () => {
    h.llm
      .mockResolvedValueOnce(toolTurn)
      .mockResolvedValueOnce({ ...toolTurn, toolCalls: [], content: "hi" });
    await channel();
    const events = usageEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "agent_message", metadata: { tokens: 2000 } });
    expect(events[0]!.metadata).not.toHaveProperty("failed");
  });
  it("records what was spent when the loop fails on a later call", async () => {
    h.llm.mockResolvedValueOnce(toolTurn).mockRejectedValueOnce(new TypeError("secret user text"));
    await expect(channel()).rejects.toThrow("secret user text");
    const events = usageEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "agent_message",
      agentId: "agent_test",
      costUsd: String(calculateCostUsd("openai:gpt-4o", 1000)),
      metadata: { tokens: 1000, model: "openai:gpt-4o", failed: true, error: "TypeError" },
    });
    expect(JSON.stringify(events)).not.toContain("secret user text");
  });
  it("records the spend when the spend cap stops a later iteration", async () => {
    h.llm.mockResolvedValue(toolTurn);
    h.spend.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("cap"));
    await expect(channel()).rejects.toThrow("cap");
    expect(usageEvents()).toHaveLength(1);
    expect(usageEvents()[0]).toMatchObject({ metadata: { tokens: 1000, failed: true } });
  });
  it("records nothing when it fails before any model call", async () => {
    h.llm.mockRejectedValueOnce(new Error("boom"));
    await expect(channel()).rejects.toThrow("boom");
    expect(usageEvents()).toHaveLength(0);
  });
});
