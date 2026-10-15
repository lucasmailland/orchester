// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactHistory } from "@/lib/memory-compaction";
import { calculateChatCostUsd } from "@/lib/pricing";

// The summarizer is a model call like any other: input and output are charged
// at their own price, not everything as output.

const h = vi.hoisted(() => ({ llm: vi.fn(), usage: vi.fn() }));
vi.mock("@orchester/db", () => ({
  getDb: () => ({ update: () => ({ set: () => ({ where: async () => undefined }) }) }),
  schema: { conversations: { id: "conversations.id" } },
}));
vi.mock("@/lib/llm-call", () => ({ llmCall: h.llm }));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/ai/run", async (original) => ({
  ...(await original<typeof import("@/lib/ai/run")>()),
  recordAiUsage: h.usage,
}));

const MODEL = "us.anthropic.claude-sonnet-4-6";
const messages = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 ? "assistant" : "user",
  content: `turn ${i}`,
  fromOperator: false,
  createdAt: new Date(0),
}));
const compact = () =>
  compactHistory({
    workspaceId: "ws_test",
    conversation: { id: "conversation_test", summary: null, messageCount: 8 },
    messages,
    keepLastN: 4,
    model: `bedrock:${MODEL}`,
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.llm.mockResolvedValue({
    content: "- summary",
    model: MODEL,
    tokensIn: 3_000,
    tokensOut: 120,
    tokensUsed: 3_120,
  });
});

describe("compaction usage", () => {
  it("charges the summary call with its input/output split", async () => {
    await compact();
    expect(h.usage).toHaveBeenCalledTimes(1);
    expect(h.usage.mock.calls[0]![0]).toMatchObject({
      workspaceId: "ws_test",
      capability: "chat",
      model: MODEL,
      tokensIn: 3_000,
      tokensOut: 120,
      tokensTotal: 3_120,
      costUsd: calculateChatCostUsd(MODEL, 3_000, 120),
    });
  });
});
