// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The flow copilot answers in one call, with the whole flow inside `set_flow`.
// A reply cut at the output limit can end in the middle of that flow.

const h = vi.hoisted(() => ({
  llm: vi.fn(),
  usage: vi.fn(),
  picked: { provider: "anthropic", model: "claude-sonnet-4-6" } as {
    provider: string;
    model: string;
  },
}));
vi.mock("@orchester/db", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ workspace: { id: "ws_test" }, user: { id: "user_test" } }),
  isAuthContext: (x: unknown) => !(x instanceof Response),
}));
vi.mock("@/lib/llm-call", () => ({
  llmCall: h.llm,
  pickAvailableModel: async () => h.picked,
}));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/ai/run", async (original) => ({
  ...(await original<typeof import("@/lib/ai/run")>()),
  recordAiUsage: h.usage,
}));

const spec = {
  nodes: [
    { id: "start", nodeId: "trigger_manual" },
    { id: "answer", nodeId: "agent" },
  ],
  edges: [{ source: "start", target: "answer" }],
};
const setFlow = { id: "t1", name: "set_flow", input: spec };
const reply = (extra: Record<string, unknown>) => ({
  content: "",
  model: h.picked.model,
  tokensIn: 900,
  tokensOut: 50,
  tokensUsed: 950,
  ...extra,
});

async function ask() {
  const { POST } = await import("@/app/api/flows/[id]/copilot/route");
  const res = await POST(
    new Request("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ prompt: "Add a step" }),
    }),
    { params: Promise.resolve({ id: "flow_test" }) }
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.picked = { provider: "anthropic", model: "claude-sonnet-4-6" };
});

describe("POST /api/flows/[id]/copilot with a reply cut at the output limit", () => {
  it("offers no flow when set_flow was cut, and says why", async () => {
    h.llm.mockResolvedValue(reply({ toolCalls: [setFlow], truncated: true }));
    const { status, body } = await ask();
    expect(status).toBe(200);
    expect(body.graph).toBeNull();
    expect(body.message).toMatch(/se cortó/);
  });

  it("offers no flow when the reply was cut before set_flow", async () => {
    h.llm.mockResolvedValue(reply({ content: "First I will", truncated: true }));
    const { body } = await ask();
    expect(body.graph).toBeNull();
    expect(body.message).toMatch(/se cortó/);
  });

  it("still charges the cut call", async () => {
    h.llm.mockResolvedValue(reply({ toolCalls: [setFlow], truncated: true }));
    await ask();
    expect(h.usage).toHaveBeenCalledTimes(1);
    expect(h.usage.mock.calls[0]![0]).toMatchObject({ flowId: "flow_test", tokensOut: 50 });
  });

  it("offers the flow of a complete reply", async () => {
    h.llm.mockResolvedValue(reply({ toolCalls: [setFlow] }));
    const { body } = await ask();
    expect(body.graph.nodes).toHaveLength(2);
    expect(body.graph.edges).toHaveLength(1);
    expect(body.message).not.toMatch(/se cortó/);
  });
});

describe("the copilot's output limit", () => {
  it.each([
    ["anthropic", "claude-sonnet-4-6"],
    ["openai", "gpt-4o-mini"],
    ["google", "gemini-1.5-flash"],
  ])("leaves room for a whole flow on %s", async (provider, model) => {
    h.picked = { provider, model };
    h.llm.mockResolvedValue(reply({ content: "What should it do?" }));
    await ask();
    expect(h.llm.mock.calls[0]![0]).toMatchObject({ model, maxTokens: 8192 });
  });

  it("keeps 2048 on Azure, whose deployment can be a model that takes no more", async () => {
    h.picked = { provider: "azure_openai", model: "gpt-35-turbo" };
    h.llm.mockResolvedValue(reply({ content: "What should it do?" }));
    await ask();
    expect(h.llm.mock.calls[0]![0]).toMatchObject({ maxTokens: 2048 });
  });
});
