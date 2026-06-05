// apps/web/tests/unit/agent-runtime-unified.test.ts
//
// Verifies the unified-recall block assembles both `<kb>` and
// `<recalled-memory>` segments when the underlying `recallUnified`
// returns mixed-source hits. Pins the rendering contract: KB chunks
// land in a per-doc `<kb source="...">` block, memory hits stay in
// the legacy `<recalled-memory>` block rendered via `renderFactsCompact`.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  recallUnifiedMock: vi.fn(),
  renderFactsCompactMock: vi.fn(),
  getOrComputeSummaryMock: vi.fn(async () => null),
  shouldTriggerRecallMock: vi.fn(() => ({ trigger: true, reason: "test", confidence: 1 })),
  applyPolicyToRecallMock: vi.fn((_p: unknown, x: unknown) => x),
}));

const { recallUnifiedMock, renderFactsCompactMock, applyPolicyToRecallMock } = mocks;

vi.mock("@mnemosyne/core", () => ({
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
  noopRerank: vi.fn(),
  makeCohereRerank: vi.fn(),
  makeLocalLexicalRerank: vi.fn(() => vi.fn(async () => [])),
  parseAgentMemoryPolicy: vi.fn((x: unknown) => x),
}));

vi.mock("@/lib/policy/agent-memory", () => ({
  getAgentMemoryPolicy: vi.fn(async () => ({
    write_scope_default: "workspace",
    read_scopes: ["workspace", "agent"],
    sensitive_categories: [],
  })),
}));

vi.mock("@/lib/settings/mnemo", () => ({
  getMnemoSettings: vi.fn(async () => ({ enableHyde: false, rerankProvider: null })),
  MNEMO_SETTING_KEYS: {
    ENABLE_HYDE: "mnemo.enable_hyde",
    RERANK_PROVIDER: "mnemo.rerank_provider",
  },
}));

vi.mock("@/lib/recall-unified", () => ({
  // The block builder still passes a kbId to makeKbChunkProvider when
  // present; we return a non-null object so the unified call sees
  // kbProvider set in its input shape.
  makeKbChunkProvider: vi.fn((kbId: string | null) => (kbId ? { search: vi.fn() } : null)),
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

beforeEach(async () => {
  recallUnifiedMock.mockReset();
  renderFactsCompactMock.mockReset();
  applyPolicyToRecallMock.mockReset();
  applyPolicyToRecallMock.mockImplementation((_p, x) => x);
  vi.resetModules();
  ({ buildRecallBlock } = await import("@/lib/agent-runtime"));
});

describe("buildRecallBlock — unified KB + memory rendering", () => {
  it("emits both <kb> and <recalled-memory> blocks when hits include both sources", async () => {
    recallUnifiedMock.mockResolvedValueOnce([
      // 2 memory hits
      {
        source: "memory",
        id: "f1",
        content: "user prefers TypeScript",
        score: 0.85,
        metadata: { kind: "preference", subject: "user", pinned: false, memoryType: "semantic" },
      },
      {
        source: "memory",
        id: "f2",
        content: "based in BA",
        score: 0.7,
        metadata: { kind: "trait", subject: "user", pinned: false, memoryType: "semantic" },
      },
      // 3 KB chunks
      {
        source: "kb",
        id: "kb_1",
        content: "Architecture decision: use Postgres for primary store.",
        score: 0.6,
        metadata: { docId: "doc_1", docTitle: "ADR-0001 Storage" },
      },
      {
        source: "kb",
        id: "kb_2",
        content: "Use Redis only as a cache layer.",
        score: 0.5,
        metadata: { docId: "doc_1", docTitle: "ADR-0001 Storage" },
      },
      {
        source: "kb",
        id: "kb_3",
        content: "Vector embeddings live in the pgvector extension.",
        score: 0.45,
        metadata: { docId: "doc_2", docTitle: "Vector Strategy" },
      },
    ]);
    renderFactsCompactMock.mockReturnValueOnce("[preference] user_pref:TS\n[trait] location:BA");

    const out = await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "remind me about our storage choices",
      history: [],
      kbId: "kb_main",
    });

    // ── Memory block uses the renderer's output verbatim.
    expect(renderFactsCompactMock).toHaveBeenCalledOnce();
    expect(out).toContain("<recalled-memory>");
    expect(out).toContain("[preference] user_pref:TS");
    expect(out).toContain("</recalled-memory>");

    // ── KB block per hit, source attribute carries the (sanitized) title.
    expect(out).toContain('<kb source="ADR-0001 Storage">');
    expect(out).toContain("Architecture decision: use Postgres for primary store.");
    expect(out).toContain("Use Redis only as a cache layer.");
    expect(out).toContain('<kb source="Vector Strategy">');
    expect(out).toContain("Vector embeddings live in the pgvector extension.");
    expect(out).toContain("</kb>");
  });

  it("renders memory-only when no kbId is provided and recall returns only memory hits", async () => {
    recallUnifiedMock.mockResolvedValueOnce([
      {
        source: "memory",
        id: "f1",
        content: "user prefers TypeScript",
        score: 0.85,
        metadata: { kind: "preference", subject: "user", pinned: false, memoryType: "semantic" },
      },
    ]);
    renderFactsCompactMock.mockReturnValueOnce("[preference] user_pref:TS");

    const out = await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "what do I prefer?",
      history: [],
    });

    expect(out).toContain("<recalled-memory>");
    expect(out).not.toContain("<kb");
  });

  it("renders KB-only when recall returns only KB chunks (memory empty)", async () => {
    recallUnifiedMock.mockResolvedValueOnce([
      {
        source: "kb",
        id: "kb_1",
        content: "The Postgres ADR is the source of truth.",
        score: 0.6,
        metadata: { docId: "doc_1", docTitle: "ADR-0001 Storage" },
      },
    ]);

    const out = await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "what's our storage adr?",
      history: [],
      kbId: "kb_main",
    });

    expect(out).not.toContain("<recalled-memory>");
    expect(out).toContain('<kb source="ADR-0001 Storage">');
    expect(out).toContain("The Postgres ADR is the source of truth.");
    // The renderer is never called when there are no memory hits.
    expect(renderFactsCompactMock).not.toHaveBeenCalled();
  });

  it("sanitizes adversarial KB doc titles for the source attribute", async () => {
    recallUnifiedMock.mockResolvedValueOnce([
      {
        source: "kb",
        id: "kb_1",
        content: "Body",
        score: 0.6,
        metadata: {
          docId: "doc_1",
          // Adversarial title trying to break out of the attribute.
          docTitle: 'foo"><script>alert(1)</script>',
        },
      },
    ]);

    const out = await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "x",
      history: [],
      kbId: "kb_main",
    });

    // The sanitizer collapses non-allowed chars to `_`; quotes / angle
    // brackets / parens must not survive — they could break the
    // attribute frame the model reads.
    expect(out).not.toContain('source="foo"');
    expect(out).not.toContain("<script>");
    expect(out).toMatch(/source="[a-z0-9 ._-]+"/i);
  });
});
