// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/ai/catalog/models";

// `recordAiUsage` writes one usage row per model dispatch: inside a workspace
// transaction, attributed to whoever spent it, and never failing the call it
// meters. `kind` and `amount` feed the plan quotas, so attribution must not
// change them.

const h = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = [];
  const insert = vi.fn((_table: unknown) => ({
    values: async (v: Record<string, unknown>) => {
      rows.push(v);
    },
  }));
  return {
    rows,
    insert,
    withTx: vi.fn(async (_ws: string, fn: (tx: unknown) => unknown) => fn({ insert })),
    getDb: vi.fn(() => ({ insert })),
    logError: vi.fn(),
    llm: vi.fn(),
  };
});
vi.mock("@orchester/db", () => ({
  getDb: h.getDb,
  schema: { usageEvents: { key: "usageEvents" } },
}));
vi.mock("@/lib/tenant/context", () => ({ withWorkspaceTx: h.withTx }));
vi.mock("@/lib/safe-log", () => ({ safeLogError: h.logError }));
vi.mock("@/lib/llm-call", () => ({ llmCall: h.llm, llmStream: vi.fn() }));
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ assertContentAllowed: vi.fn() }));
vi.mock("@/lib/ai/credentials", () => ({ loadCredential: async () => ({ apiKey: "test" }) }));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ put: vi.fn(), url: (key: string) => `https://files.test/${key}` }),
  makeKey: (_ws: string, prefix: string, name: string) => `${prefix}/${name}`,
}));
vi.mock("@/lib/ai/adapters/images", () => ({
  generateImageWith: async () => ({ images: [{ url: "https://img.test/a.png" }] }),
}));
vi.mock("@/lib/ai/adapters/embeddings", () => ({
  embedWith: async () => ({ vectors: [[0.1]], tokensUsed: 7 }),
}));
vi.mock("@/lib/ai/adapters/media", () => ({
  generateVideoWith: async () => ({ url: "https://media.test/v.mp4" }),
  generateMusicWith: async () => ({ url: "https://media.test/m.mp3" }),
  speakWith: async () => ({ bytes: Buffer.from("x"), mime: "audio/mpeg" }),
  transcribeWith: async () => ({ text: "hello" }),
}));
vi.mock("@/lib/ai/adapters/rerank", () => ({ rerankWith: async () => ({ results: [] }) }));
vi.mock("@/lib/ai/adapters/avatar", () => ({
  generateAvatarWith: async () => ({ url: "https://media.test/a.mp4" }),
}));
vi.mock("@/lib/ai/adapters/ocr", () => ({ ocrWith: async () => ({ text: "page" }) }));

const run = await import("@/lib/ai/run");
const { recordAiUsage } = run;

const ATTRIBUTION = {
  agentId: "agent_test",
  flowId: "flow_test",
  flowRunId: "run_test",
  nodeId: "node_test",
  conversationId: "conversation_test",
};
const chat = {
  workspaceId: "ws_test",
  capability: "chat",
  model: "us.anthropic.claude-sonnet-4-6",
  tokensIn: 40_000,
  tokensOut: 2_000,
  tokensTotal: 42_000,
  costUsd: 0.15,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.length = 0;
});

describe("recordAiUsage", () => {
  it("writes inside the workspace transaction, not on a bare connection", async () => {
    await recordAiUsage(chat);
    expect(h.withTx).toHaveBeenCalledTimes(1);
    expect(h.withTx.mock.calls[0]![0]).toBe("ws_test");
    expect(h.getDb).not.toHaveBeenCalled();
    expect(h.rows).toHaveLength(1);
  });

  it("writes agent and flow to their columns and the rest to metadata", async () => {
    await recordAiUsage({ ...chat, ...ATTRIBUTION });
    expect(h.rows[0]).toMatchObject({
      workspaceId: "ws_test",
      agentId: "agent_test",
      flowId: "flow_test",
      metadata: {
        model: chat.model,
        capability: "chat",
        tokensIn: 40_000,
        tokensOut: 2_000,
        tokensTotal: 42_000,
        flowRunId: "run_test",
        nodeId: "node_test",
        conversationId: "conversation_test",
      },
    });
  });

  it("leaves attribution out when the caller has none", async () => {
    await recordAiUsage(chat);
    expect(h.rows[0]).not.toHaveProperty("agentId");
    expect(h.rows[0]).not.toHaveProperty("flowId");
    expect(h.rows[0]!.metadata).toEqual({
      model: chat.model,
      capability: "chat",
      tokensIn: 40_000,
      tokensOut: 2_000,
      tokensTotal: 42_000,
    });
  });

  it("keeps prompt cache tokens in metadata", async () => {
    await recordAiUsage({ ...chat, cacheWriteTokens: 7_000, cacheReadTokens: 1_200 });
    expect(h.rows[0]!.metadata).toMatchObject({ cacheWriteTokens: 7_000, cacheReadTokens: 1_200 });
  });

  it("keeps kind and amount: one tokens_out per chat call, whatever its size", async () => {
    // checkQuota sums `amount`; a token count here would exhaust a plan's
    // monthly token limit within a few conversations.
    await recordAiUsage({ ...chat, ...ATTRIBUTION });
    await recordAiUsage({ ...chat, capability: "embedding", ...ATTRIBUTION });
    await recordAiUsage({ ...chat, capability: "image", units: 3, ...ATTRIBUTION });
    expect(h.rows.map((r) => [r.kind, r.amount, r.costUsd])).toEqual([
      ["tokens_out", 1, "0.15"],
      ["tokens_out", 1, "0.15"],
      ["flow_run", 3, "0.15"],
    ]);
  });

  it("never throws when the insert fails", async () => {
    h.insert.mockImplementationOnce(() => {
      throw new Error("insert failed");
    });
    await expect(recordAiUsage(chat)).resolves.toBeUndefined();
    expect(h.logError).toHaveBeenCalledWith(
      expect.stringContaining("recordAiUsage"),
      expect.any(Error)
    );
  });

  it("never throws when the transaction cannot open", async () => {
    h.withTx.mockRejectedValueOnce(new Error("pool exhausted"));
    await expect(recordAiUsage(chat)).resolves.toBeUndefined();
    expect(h.logError).toHaveBeenCalledTimes(1);
  });
});

describe("run helpers pass attribution through", () => {
  const modelFor = (capability: string) => MODELS.find((m) => m.capability === capability)!.id;
  const FLOW_STEP = { flowId: "flow_test", flowRunId: "run_test", nodeId: "node_test" };

  it("runChat", async () => {
    h.llm.mockResolvedValue({
      content: "ok",
      model: "m",
      tokensIn: 3,
      tokensOut: 2,
      tokensUsed: 5,
    });
    await run.runChat(
      { workspaceId: "ws_test", model: "openai:gpt-4o", systemPrompt: "", messages: [] },
      { attribution: { agentId: "agent_test", ...FLOW_STEP } }
    );
    expect(h.rows[0]).toMatchObject({
      kind: "tokens_out",
      amount: 1,
      agentId: "agent_test",
      flowId: "flow_test",
      metadata: { flowRunId: "run_test", nodeId: "node_test", tokensIn: 3, tokensOut: 2 },
    });
  });

  const helpers: Array<[string, (attribution?: typeof FLOW_STEP) => Promise<unknown>]> = [
    ["generateImage", (a) => run.generateImage("ws_test", modelFor("image"), { prompt: "p" }, a)],
    ["embed", (a) => run.embed("ws_test", modelFor("embedding"), ["text"], a)],
    ["generateVideo", (a) => run.generateVideo("ws_test", modelFor("video"), "p", a)],
    ["textToSpeech", (a) => run.textToSpeech("ws_test", modelFor("tts"), "say", undefined, a)],
    ["transcribe", (a) => run.transcribe("ws_test", modelFor("stt"), "https://a.test/x", a)],
    ["rerank", (a) => run.rerank("ws_test", modelFor("rerank"), "q", ["a", "b"], undefined, a)],
    ["generateAvatar", (a) => run.generateAvatar("ws_test", modelFor("avatar"), { text: "t" }, a)],
    ["generateMusic", (a) => run.generateMusic("ws_test", modelFor("music"), "p", a)],
    ["ocr", (a) => run.ocr("ws_test", modelFor("ocr"), "https://a.test/doc.pdf", a)],
  ];

  it.each(helpers)("%s", async (_name, call) => {
    await call();
    await call(FLOW_STEP);
    const [plain, attributed] = h.rows;
    expect(attributed).toMatchObject({
      flowId: "flow_test",
      metadata: { flowRunId: "run_test", nodeId: "node_test" },
    });
    expect(attributed).not.toHaveProperty("agentId");
    // Attribution adds who spent it; what is counted stays the same.
    expect([attributed!.kind, attributed!.amount, attributed!.costUsd]).toEqual([
      plain!.kind,
      plain!.amount,
      plain!.costUsd,
    ]);
    expect(plain).not.toHaveProperty("flowId");
  });
});

describe("chargeFor and the prompt cache", () => {
  const MODEL_ID = "us.anthropic.claude-sonnet-4-6";
  const base = { model: MODEL_ID, tokensUsed: 700, tokensIn: 400, tokensOut: 300 };

  it("adds the cache the provider reported to the cost and returns its tokens", async () => {
    const { calculateChatCostUsd } = await import("@/lib/pricing");
    const charge = run.chargeFor({
      ...base,
      cacheUsage: {
        inputTokens: 400,
        outputTokens: 300,
        cacheCreationTokens: 7_000,
        cacheReadTokens: 900,
      },
    });
    expect(charge).toEqual({
      tokensIn: 400,
      tokensOut: 300,
      tokensTotal: 700,
      cacheWriteTokens: 7_000,
      cacheReadTokens: 900,
      costUsd: calculateChatCostUsd(MODEL_ID, 400, 300, { writeTokens: 7_000, readTokens: 900 }),
    });
    // The cache must matter, or this test proves nothing.
    expect(charge.costUsd).toBeGreaterThan(calculateChatCostUsd(MODEL_ID, 400, 300));
  });

  it("leaves the cache out when the provider reports none", async () => {
    const { calculateChatCostUsd } = await import("@/lib/pricing");
    expect(run.chargeFor(base)).toEqual({
      tokensIn: 400,
      tokensOut: 300,
      tokensTotal: 700,
      costUsd: calculateChatCostUsd(MODEL_ID, 400, 300),
    });
  });
});
