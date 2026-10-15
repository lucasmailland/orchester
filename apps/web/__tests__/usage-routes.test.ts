// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateChatCostUsd } from "@/lib/pricing";

// What the studio routes that call a model record as usage.

const MODEL = "us.anthropic.claude-sonnet-4-6";
const h = vi.hoisted(() => ({ llm: vi.fn(), stream: vi.fn(), usage: vi.fn() }));
vi.mock("@orchester/db", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ workspace: { id: "ws_test" }, user: { id: "user_test" } }),
  isAuthContext: (x: unknown) => !(x instanceof Response),
}));
vi.mock("@/lib/llm-call", () => ({
  llmCall: h.llm,
  llmStream: h.stream,
  pickAvailableModel: async () => ({ provider: "bedrock", model: MODEL }),
  ProviderNotConfiguredError: class extends Error {},
}));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null, RATE_LIMITS: {} }));
vi.mock("@/lib/agent-runtime", () => ({
  loadAgent: async (_ws: string, id: string) => ({ id, variables: {} }),
}));
vi.mock("@/lib/ai/run", async (original) => ({
  ...(await original<typeof import("@/lib/ai/run")>()),
  recordAiUsage: h.usage,
}));

const request = (body: unknown) =>
  new Request("https://example.com/api", { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/agents/[id]/generate-prompt", () => {
  it("charges the call with its input/output split", async () => {
    h.llm.mockResolvedValue({
      content: '["a","b","c"]',
      model: MODEL,
      tokensIn: 400,
      tokensOut: 2_600,
      tokensUsed: 3_000,
    });
    const { POST } = await import("@/app/api/agents/[id]/generate-prompt/route");
    const res = await POST(request({ description: "A support agent" }), params("agent_test"));
    expect(res.status).toBe(200);
    expect(h.usage).toHaveBeenCalledTimes(1);
    expect(h.usage.mock.calls[0]![0]).toMatchObject({
      workspaceId: "ws_test",
      capability: "chat",
      model: MODEL,
      tokensIn: 400,
      tokensOut: 2_600,
      tokensTotal: 3_000,
      costUsd: calculateChatCostUsd(MODEL, 400, 2_600),
      agentId: "agent_test",
    });
    expect(h.usage.mock.calls[0]![0]).not.toHaveProperty("units");
  });
});

describe("POST /api/agents/[id]/test-chat-stream", () => {
  it("charges the streamed reply once, when the stream is done", async () => {
    h.stream.mockImplementation(async function* () {
      yield { type: "text", delta: "hi" };
      yield { type: "done", tokensUsed: 800, model: MODEL };
    });
    const { POST } = await import("@/app/api/agents/[id]/test-chat-stream/route");
    const res = await POST(
      request({
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: "Be brief",
        model: `bedrock:${MODEL}`,
      }),
      params("agent_test")
    );
    await res.text();
    expect(h.usage).toHaveBeenCalledTimes(1);
    // A stream reports only the total, so it is charged as output, as before.
    expect(h.usage.mock.calls[0]![0]).toMatchObject({
      workspaceId: "ws_test",
      capability: "chat",
      model: MODEL,
      tokensOut: 800,
      tokensTotal: 800,
      costUsd: calculateChatCostUsd(MODEL, 0, 800),
      agentId: "agent_test",
    });
  });
});

describe("POST /api/flows/[id]/copilot", () => {
  it("attributes the copilot call to the flow being edited", async () => {
    h.llm.mockResolvedValue({
      content: "What should it do?",
      model: MODEL,
      tokensIn: 900,
      tokensOut: 50,
      tokensUsed: 950,
    });
    const { POST } = await import("@/app/api/flows/[id]/copilot/route");
    const res = await POST(request({ prompt: "Build a flow" }), params("flow_test"));
    expect(res.status).toBe(200);
    expect(h.usage).toHaveBeenCalledTimes(1);
    expect(h.usage.mock.calls[0]![0]).toMatchObject({
      workspaceId: "ws_test",
      capability: "chat",
      flowId: "flow_test",
      tokensIn: 900,
      tokensOut: 50,
      costUsd: calculateChatCostUsd(MODEL, 900, 50),
    });
    expect(h.usage.mock.calls[0]![0]).not.toHaveProperty("agentId");
  });
});
