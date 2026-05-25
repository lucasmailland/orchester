// apps/web/tests/unit/agent-runtime-tiered.test.ts
//
// Unit tests for the Mnemosyne v1.1 tiered memory injection wired into
// agent-runtime. These exercise the three new seams:
//
//   1. `shouldTriggerRecall` returns trigger:false → no `searchMnemo` call,
//      `buildRecallBlock` returns "".
//   2. `getOrComputeSummary` returns null (cold start) → `buildProfileBlock`
//      returns "", the rest of the cached prefix still works.
//   3. `buildAnthropicSystem` (from llm-call) marks the prefix portion of
//      the prompt with `cache_control: ephemeral` when a boundary is set.
//   4. Defensive: when `getOrComputeSummary` THROWS, `buildProfileBlock`
//      returns "" rather than propagating the error. Same for `searchMnemo`.
//
// We mock `@orchester/mnemosyne` so the helpers don't reach into a real
// DB / pgvector index. The shape of each mock matches the public types
// in `packages/mnemosyne/src/index.ts`.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for @orchester/mnemosyne. Each function is a `vi.fn()` so per-
// test we can `.mockReturnValueOnce` / `.mockResolvedValueOnce` and assert
// call counts. The constants are passthroughs so the runtime can still
// import them for its prompt assembly (not exercised in these unit tests).
const searchMnemoMock = vi.fn();
const renderFactsCompactMock = vi.fn();
const getOrComputeSummaryMock = vi.fn();
const shouldTriggerRecallMock = vi.fn();

vi.mock("@orchester/mnemosyne", () => ({
  MEMORY_PROTOCOL_V1: "MEMORY_PROTOCOL_V1_FIXTURE_TEXT",
  searchMnemo: searchMnemoMock,
  renderFactsCompact: renderFactsCompactMock,
  getOrComputeSummary: getOrComputeSummaryMock,
  shouldTriggerRecall: shouldTriggerRecallMock,
}));

// `safeLogError` is exercised on defensive paths — quiet it so the test
// output stays readable and we can assert it was called.
const safeLogErrorMock = vi.fn();
vi.mock("@/lib/safe-log", () => ({
  safeLogError: safeLogErrorMock,
  safeLogWarn: vi.fn(),
}));

// agent-runtime pulls in llm-call (and transitively the AI catalog) — we
// don't call llmCall in these tests but the module-level import would
// still load the file. Stub `llmCall` to a no-op while keeping the real
// `buildAnthropicSystem` (we test it directly). Using `importActual`
// keeps the other named exports (types, etc.) intact so other consumers
// of the mock don't break.
vi.mock("@/lib/llm-call", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm-call")>("@/lib/llm-call");
  return {
    ...actual,
    llmCall: vi.fn(),
  };
});

vi.mock("@/lib/tools", () => ({
  executeTool: vi.fn(),
  getToolDefinitions: vi.fn(() => []),
}));

vi.mock("@/lib/cost-alerts", () => ({
  assertWithinSpend: vi.fn(),
}));

vi.mock("@/lib/ai/run", () => ({
  recordAiUsage: vi.fn(),
}));

vi.mock("@/lib/pricing", () => ({
  calculateChatCostUsd: vi.fn(() => 0),
}));

// Import after mocks are in place.
let buildRecallBlock: typeof import("@/lib/agent-runtime").buildRecallBlock;
let buildProfileBlock: typeof import("@/lib/agent-runtime").buildProfileBlock;
let buildAnthropicSystem: typeof import("@/lib/llm-call").buildAnthropicSystem;

beforeEach(async () => {
  searchMnemoMock.mockReset();
  renderFactsCompactMock.mockReset();
  getOrComputeSummaryMock.mockReset();
  shouldTriggerRecallMock.mockReset();
  safeLogErrorMock.mockReset();
  vi.resetModules();
  ({ buildRecallBlock, buildProfileBlock } = await import("@/lib/agent-runtime"));
  ({ buildAnthropicSystem } = await import("@/lib/llm-call"));
});

describe("buildRecallBlock — Layer 2 conditional recall", () => {
  it("skips searchMnemo when shouldTriggerRecall returns false", async () => {
    shouldTriggerRecallMock.mockReturnValueOnce({
      trigger: false,
      reason: "greeting",
      confidence: 0.95,
    });

    const out = await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "ok",
      history: [],
    });

    expect(out).toBe("");
    // ── The whole point of the trigger: we don't pay for a vector
    // search when the user just said "ok". If this fails, Layer 2 is
    // running on every turn and the cost-optimization is silently undone.
    expect(searchMnemoMock).not.toHaveBeenCalled();
    expect(renderFactsCompactMock).not.toHaveBeenCalled();
  });

  it("calls searchMnemo with maxResults:3 when trigger fires", async () => {
    shouldTriggerRecallMock.mockReturnValueOnce({
      trigger: true,
      reason: "reference_word",
      confidence: 0.95,
    });
    searchMnemoMock.mockResolvedValueOnce([
      { fact: { id: "f1", kind: "preference", subject: "user", statement: "uses TS" } },
      { fact: { id: "f2", kind: "preference", subject: "user", statement: "based in BA" } },
    ]);
    renderFactsCompactMock.mockReturnValueOnce("[preference] lang:TS, location:BA");

    const out = await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "what was the language we discussed before?",
      history: [{ role: "user", content: "hi" }],
    });

    expect(searchMnemoMock).toHaveBeenCalledOnce();
    const call = searchMnemoMock.mock.calls[0]![0];
    expect(call.maxResults).toBe(3);
    expect(call.workspaceId).toBe("ws_1");
    expect(call.agentId).toBe("ag_1");
    expect(call.query).toBe("what was the language we discussed before?");
    // Block wraps render output in <recalled-memory>.
    expect(out).toContain("<recalled-memory>");
    expect(out).toContain("[preference] lang:TS, location:BA");
    expect(out).toContain("</recalled-memory>");
  });

  it("returns empty when searchMnemo finds zero hits", async () => {
    shouldTriggerRecallMock.mockReturnValueOnce({
      trigger: true,
      reason: "default",
      confidence: 0.5,
    });
    searchMnemoMock.mockResolvedValueOnce([]);

    const out = await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "tell me about widgets",
      history: [],
    });

    expect(out).toBe("");
    expect(renderFactsCompactMock).not.toHaveBeenCalled();
  });

  it("returns empty + logs when searchMnemo throws (defensive)", async () => {
    shouldTriggerRecallMock.mockReturnValueOnce({
      trigger: true,
      reason: "default",
      confidence: 0.5,
    });
    searchMnemoMock.mockRejectedValueOnce(new Error("pgvector index missing"));

    const out = await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "tell me about widgets",
      history: [],
    });

    // Recall is OPTIMIZATION — a DB failure must NEVER break a turn.
    expect(out).toBe("");
    expect(safeLogErrorMock).toHaveBeenCalledOnce();
    expect(safeLogErrorMock.mock.calls[0]![0]).toContain("searchMnemo");
  });

  it("defaults to trigger=true when shouldTriggerRecall itself throws", async () => {
    shouldTriggerRecallMock.mockImplementationOnce(() => {
      throw new Error("classifier blew up");
    });
    searchMnemoMock.mockResolvedValueOnce([]);

    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "a normal question about widgets",
      history: [],
    });

    // Trigger failure is logged and we proceed AS IF triggered — over-
    // recall is the safe failure mode (under-recall hides context).
    expect(safeLogErrorMock).toHaveBeenCalled();
    expect(searchMnemoMock).toHaveBeenCalledOnce();
  });
});

describe("buildProfileBlock — Layer 1 cached prefix", () => {
  it("returns empty on cold start (getOrComputeSummary → null)", async () => {
    getOrComputeSummaryMock.mockResolvedValueOnce(null);

    const out = await buildProfileBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userId: "u_1",
    });

    expect(out).toBe("");
    // No <user-profile> block — the rest of the cached prefix
    // (identity + Memory Protocol) must still assemble on its own.
  });

  it("wraps rawText in <user-profile freshness=...> when summary present", async () => {
    getOrComputeSummaryMock.mockResolvedValueOnce({
      identity: "Lucas | AR/BA",
      rawText: "Lucas, CEO of Acme. Uses TypeScript + Postgres.",
      freshness: "fresh",
      sourceFactIds: ["f1", "f2"],
      generatedAt: new Date(),
      tokenCount: 18,
    });

    const out = await buildProfileBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userId: "u_1",
    });

    expect(out).toContain('<user-profile freshness="fresh">');
    expect(out).toContain("Lucas, CEO of Acme. Uses TypeScript + Postgres.");
    expect(out).toContain("</user-profile>");
  });

  it("returns empty when getOrComputeSummary throws (defensive)", async () => {
    getOrComputeSummaryMock.mockRejectedValueOnce(new Error("DB hiccup"));

    const out = await buildProfileBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userId: "u_1",
    });

    // A summary fetch failure must NEVER break the prompt assembly —
    // we'd rather lose the profile injection than fail the turn.
    expect(out).toBe("");
    expect(safeLogErrorMock).toHaveBeenCalledOnce();
    expect(safeLogErrorMock.mock.calls[0]![0]).toContain("getOrComputeSummary");
  });

  it("omits userId from the call when not provided", async () => {
    getOrComputeSummaryMock.mockResolvedValueOnce(null);

    await buildProfileBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
    });

    const callArg = getOrComputeSummaryMock.mock.calls[0]![0];
    expect(callArg.workspaceId).toBe("ws_1");
    expect(callArg.agentId).toBe("ag_1");
    expect(callArg.userId).toBeUndefined();
  });
});

describe("buildAnthropicSystem — cache_control plumbing (llm-call)", () => {
  it("returns plain string when no boundary is set", () => {
    const out = buildAnthropicSystem("hello world", undefined);
    expect(out).toBe("hello world");
  });

  it("returns single cached block when boundary >= prompt.length", () => {
    // The cache-the-whole-prompt case — first time the prefix is
    // cached, every subsequent turn within 5min hits at ~10%.
    const out = buildAnthropicSystem("STATIC PREFIX", 13);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([
      { type: "text", text: "STATIC PREFIX", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("splits into cached + uncached when boundary is inside the prompt", () => {
    const out = buildAnthropicSystem("STATICDYNAMIC", 6);
    expect(out).toEqual([
      { type: "text", text: "STATIC", cache_control: { type: "ephemeral" } },
      { type: "text", text: "DYNAMIC" },
    ]);
  });

  it("FIRST block always carries cache_control (Mnemosyne v1.1 invariant)", () => {
    // The whole point of this layer is that THE FIRST system block is
    // the cached one. If a future refactor accidentally puts the
    // dynamic suffix first, the cache is useless: every turn becomes a
    // cache miss because the static prefix appears at a different
    // offset. This test pins the contract.
    const out = buildAnthropicSystem("PREFIX|SUFFIX", 7);
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out[0]!.cache_control).toEqual({ type: "ephemeral" });
      expect(out[1]!.cache_control).toBeUndefined();
    }
  });

  it("collapses to plain string when boundary is invalid (defensive)", () => {
    expect(buildAnthropicSystem("hello", 0)).toBe("hello");
    expect(buildAnthropicSystem("hello", -5)).toBe("hello");
    expect(buildAnthropicSystem("hello", 3.7 as unknown as number)).toBe("hello");
    expect(buildAnthropicSystem("", 5)).toBe("");
  });
});
