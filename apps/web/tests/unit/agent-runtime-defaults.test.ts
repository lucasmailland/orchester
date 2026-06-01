// apps/web/tests/unit/agent-runtime-defaults.test.ts
//
// Mnemosyne v1.6 "True 10/10" — verifies the defaults flip in
// agent-runtime.ts. The three opt-ins (HyDE / cross-encoder rerank /
// 1-hop graph expansion) are ALL default-ON; the three new
// `disable_*` kill-switches let an operator opt OUT per-workspace.
//
// Covered cases:
//   1. With DEFAULT_SETTINGS (no disable_* flags) → buildRecallBlock
//      calls recallUnified with enableHyDE: true, expandGraph: true,
//      and a non-undefined rerank fn.
//   2. With disable_hyde=true → enableHyDE: false in the call.
//   3. With disable_rerank=true → rerank is undefined in the call.
//   4. With disable_graph=true → expandGraph: false in the call.
//   5. With ALL kill-switches set → all three options off.
//   6. Without COHERE_API_KEY but with rerank enabled → rerank fn is
//      still set (falls back to the local lexical reranker).

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  recallUnifiedMock: vi.fn(),
  renderFactsCompactMock: vi.fn(() => "rendered"),
  getOrComputeSummaryMock: vi.fn(async () => null),
  shouldTriggerRecallMock: vi.fn(() => ({ trigger: true, reason: "test", confidence: 1 })),
  applyPolicyToRecallMock: vi.fn((_p: unknown, x: unknown) => x),
  makeCohereRerankMock: vi.fn(() => async () => [0]),
  getMnemoSettingsMock: vi.fn(),
}));

// Use a partial mock so the REAL `makeLocalLexicalRerank` flows
// through — this test asserts the actual lexical-overlap ordering
// works end-to-end ("user prefers espresso" must rank above the
// no-overlap distractors). Other package exports stay mocked.
vi.mock("@orchester/mnemosyne", async () => {
  const actual =
    await vi.importActual<typeof import("@orchester/mnemosyne")>("@orchester/mnemosyne");
  return {
    MEMORY_PROTOCOL_V1: "PROTOCOL_FIXTURE",
    MEMORY_RECALL_GUIDANCE: "RECALL_GUIDANCE_FIXTURE",
    DEFAULT_AGENT_MEMORY_POLICY: {
      write_scope_default: "workspace",
      read_scopes: ["workspace", "agent"],
      sensitive_categories: [],
    },
    applyPolicyToRecall: mocks.applyPolicyToRecallMock,
    recallUnified: mocks.recallUnifiedMock,
    renderFactsCompact: mocks.renderFactsCompactMock,
    getOrComputeSummary: mocks.getOrComputeSummaryMock,
    shouldTriggerRecall: mocks.shouldTriggerRecallMock,
    makeCohereRerank: mocks.makeCohereRerankMock,
    // v2 — pass through the real impl so the "falls back to local
    // lexical reranker" test exercises the actual scoring.
    makeLocalLexicalRerank: actual.makeLocalLexicalRerank,
    parseAgentMemoryPolicy: vi.fn((x: unknown) => x),
  };
});

vi.mock("@/lib/policy/agent-memory", () => ({
  getAgentMemoryPolicy: vi.fn(async () => ({
    write_scope_default: "workspace",
    read_scopes: ["workspace", "agent"],
    sensitive_categories: [],
  })),
}));

vi.mock("@/lib/settings/mnemo", () => ({
  getMnemoSettings: mocks.getMnemoSettingsMock,
  MNEMO_SETTING_KEYS: {
    ENABLE_HYDE: "mnemo.enable_hyde",
    RERANK_PROVIDER: "mnemo.rerank_provider",
    DISABLE_HYDE: "mnemo.disable_hyde",
    DISABLE_RERANK: "mnemo.disable_rerank",
    DISABLE_GRAPH: "mnemo.disable_graph",
    PREMIUM_EMBEDDING: "mnemo.premium_embedding",
  },
}));

vi.mock("@/lib/recall-unified", () => ({
  makeKbChunkProvider: vi.fn(() => null),
}));

vi.mock("@/lib/agent-tools/mnemosyne-remember", () => ({
  handleMnemosyneRemember: vi.fn(),
}));

vi.mock("@/lib/safe-log", () => ({
  safeLogError: vi.fn(),
  safeLogWarn: vi.fn(),
}));

vi.mock("@/lib/llm-call", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm-call")>("@/lib/llm-call");
  return { ...actual, llmCall: vi.fn() };
});

vi.mock("@/lib/tools", () => ({
  executeTool: vi.fn(),
  getToolDefinitions: vi.fn(() => []),
}));

vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ recordAiUsage: vi.fn() }));
vi.mock("@/lib/pricing", () => ({ calculateChatCostUsd: vi.fn(() => 0) }));

let buildRecallBlock: typeof import("@/lib/agent-runtime").buildRecallBlock;

const DEFAULT_V16_SETTINGS = {
  // legacy
  enableHyde: false,
  rerankProvider: null,
  // v1.6 — every kill-switch starts false → every feature is ON.
  disableHyde: false,
  disableRerank: false,
  disableGraph: false,
  premiumEmbeddingProvider: null,
};

beforeEach(async () => {
  mocks.recallUnifiedMock.mockReset();
  mocks.recallUnifiedMock.mockResolvedValue([]);
  mocks.renderFactsCompactMock.mockReset();
  mocks.applyPolicyToRecallMock.mockReset();
  mocks.applyPolicyToRecallMock.mockImplementation((_p: unknown, x: unknown) => x);
  mocks.makeCohereRerankMock.mockReset();
  mocks.makeCohereRerankMock.mockImplementation(() => async () => [0]);
  mocks.getMnemoSettingsMock.mockReset();
  vi.resetModules();
  ({ buildRecallBlock } = await import("@/lib/agent-runtime"));
});

function callArgs() {
  expect(mocks.recallUnifiedMock).toHaveBeenCalledTimes(1);
  return mocks.recallUnifiedMock.mock.calls[0]![0] as Record<string, unknown>;
}

describe("agent-runtime — v1.6 defaults flip", () => {
  it("defaults: HyDE ON, expandGraph ON, rerank fn set", async () => {
    mocks.getMnemoSettingsMock.mockResolvedValueOnce(DEFAULT_V16_SETTINGS);
    process.env.COHERE_API_KEY = "test-key";
    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "agent_1",
      userTurn: "what does the user prefer?",
      history: [],
    });
    const args = callArgs();
    expect(args.enableHyDE).toBe(true);
    expect(args.expandGraph).toBe(true);
    expect(typeof args.rerank).toBe("function");
    delete process.env.COHERE_API_KEY;
  });

  it("disable_hyde=true → enableHyDE: false", async () => {
    mocks.getMnemoSettingsMock.mockResolvedValueOnce({
      ...DEFAULT_V16_SETTINGS,
      disableHyde: true,
    });
    process.env.COHERE_API_KEY = "test-key";
    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "agent_1",
      userTurn: "anything",
      history: [],
    });
    const args = callArgs();
    expect(args.enableHyDE).toBe(false);
    expect(args.expandGraph).toBe(true);
    expect(typeof args.rerank).toBe("function");
    delete process.env.COHERE_API_KEY;
  });

  it("disable_rerank=true → rerank fn is undefined", async () => {
    mocks.getMnemoSettingsMock.mockResolvedValueOnce({
      ...DEFAULT_V16_SETTINGS,
      disableRerank: true,
    });
    process.env.COHERE_API_KEY = "test-key";
    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "agent_1",
      userTurn: "anything",
      history: [],
    });
    const args = callArgs();
    expect(args.enableHyDE).toBe(true);
    expect(args.expandGraph).toBe(true);
    expect(args.rerank).toBeUndefined();
    delete process.env.COHERE_API_KEY;
  });

  it("disable_graph=true → expandGraph: false", async () => {
    mocks.getMnemoSettingsMock.mockResolvedValueOnce({
      ...DEFAULT_V16_SETTINGS,
      disableGraph: true,
    });
    process.env.COHERE_API_KEY = "test-key";
    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "agent_1",
      userTurn: "anything",
      history: [],
    });
    const args = callArgs();
    expect(args.enableHyDE).toBe(true);
    expect(args.expandGraph).toBe(false);
    expect(typeof args.rerank).toBe("function");
    delete process.env.COHERE_API_KEY;
  });

  it("all kill-switches set → all three options off", async () => {
    mocks.getMnemoSettingsMock.mockResolvedValueOnce({
      ...DEFAULT_V16_SETTINGS,
      disableHyde: true,
      disableRerank: true,
      disableGraph: true,
    });
    process.env.COHERE_API_KEY = "test-key";
    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "agent_1",
      userTurn: "anything",
      history: [],
    });
    const args = callArgs();
    expect(args.enableHyDE).toBe(false);
    expect(args.expandGraph).toBe(false);
    expect(args.rerank).toBeUndefined();
    delete process.env.COHERE_API_KEY;
  });

  it("rerank ON but no COHERE_API_KEY → falls back to local lexical reranker", async () => {
    mocks.getMnemoSettingsMock.mockResolvedValueOnce(DEFAULT_V16_SETTINGS);
    delete process.env.COHERE_API_KEY;
    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "agent_1",
      userTurn: "anything",
      history: [],
    });
    const args = callArgs();
    // rerank should still be a function (the local lexical one), not undefined.
    expect(typeof args.rerank).toBe("function");
    // The local reranker should be functional — call it with sample docs
    // and verify it returns indices in sane range.
    const rerankFn = args.rerank as (input: {
      query: string;
      documents: string[];
      topK: number;
    }) => Promise<number[]>;
    const out = await rerankFn({
      query: "espresso coffee morning",
      documents: ["user prefers espresso", "user listens to jazz", "user reads books"],
      topK: 2,
    });
    expect(out.length).toBeLessThanOrEqual(2);
    // The first doc has overlap with "espresso" — local reranker should
    // surface it at the top.
    expect(out[0]).toBe(0);
  });
});
