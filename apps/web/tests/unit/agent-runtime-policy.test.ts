// apps/web/tests/unit/agent-runtime-policy.test.ts
//
// Per-agent memory policy → recall + write path tests (v1.5 F2).
//
// Two scenarios:
//   1. recall — agent with read_scopes: ['workspace'] only → buildRecallBlock
//      narrows the recallUnified input to `scope: 'global'`, filtering out
//      conversation / employee / team-scoped facts at the DB layer.
//   2. write — agent with sensitive_categories: ['email'] writing a fact
//      whose statement contains an email → handleMnemosyneRemember
//      downgrades the scope to 'global' (agent-partition) even when the
//      caller asked for 'team'.
//
// We mock the DB layer (drizzle), the queue, and detectPII so each test
// pins one invariant in isolation.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so the mock objects survive the vi.mock hoist pass
// (mock factories run BEFORE module-level consts are initialized).
const mocks = vi.hoisted(() => ({
  applyPolicyToRecallMock: vi.fn(),
  applyPolicyToWriteMock: vi.fn(),
  detectPIIMock: vi.fn(),
  createFactAsyncMock: vi.fn(),
  withMnemoTxMock: vi.fn(async (_ws: string, cb: (tx: unknown) => Promise<unknown>) =>
    cb({ execute: vi.fn(), select: vi.fn() })
  ),
  recallUnifiedMock: vi.fn(),
  renderFactsCompactMock: vi.fn(() => "compact-render-fixture"),
  getOrComputeSummaryMock: vi.fn(async () => null),
  shouldTriggerRecallMock: vi.fn(() => ({ trigger: true, reason: "test", confidence: 1 })),
  getAgentMemoryPolicyMock: vi.fn(),
  enqueueMock: vi.fn(async () => "job-id"),
}));

const {
  applyPolicyToRecallMock,
  applyPolicyToWriteMock,
  detectPIIMock,
  createFactAsyncMock,
  withMnemoTxMock,
  recallUnifiedMock,
  renderFactsCompactMock,
  getOrComputeSummaryMock,
  shouldTriggerRecallMock,
  getAgentMemoryPolicyMock,
  enqueueMock,
} = mocks;

const DEFAULT_AGENT_MEMORY_POLICY = {
  write_scope_default: "workspace",
  read_scopes: ["workspace", "agent"],
  sensitive_categories: [],
} as const;

vi.mock("@orchester/mnemosyne", () => ({
  MEMORY_PROTOCOL_V1: "PROTOCOL_FIXTURE",
  DEFAULT_AGENT_MEMORY_POLICY: {
    write_scope_default: "workspace",
    read_scopes: ["workspace", "agent"],
    sensitive_categories: [],
  },
  applyPolicyToRecall: mocks.applyPolicyToRecallMock,
  applyPolicyToWrite: mocks.applyPolicyToWriteMock,
  detectPII: mocks.detectPIIMock,
  createFactAsync: mocks.createFactAsyncMock,
  withMnemoTx: mocks.withMnemoTxMock,
  recallUnified: mocks.recallUnifiedMock,
  renderFactsCompact: mocks.renderFactsCompactMock,
  getOrComputeSummary: mocks.getOrComputeSummaryMock,
  shouldTriggerRecall: mocks.shouldTriggerRecallMock,
  noopRerank: vi.fn(),
  makeCohereRerank: vi.fn(),
  parseAgentMemoryPolicy: vi.fn((x) => x),
}));

// ─── Mock host helpers ───────────────────────────────────────────────
vi.mock("@/lib/policy/agent-memory", () => ({
  getAgentMemoryPolicy: mocks.getAgentMemoryPolicyMock,
}));

vi.mock("@/lib/settings/mnemo", () => ({
  getMnemoSettings: vi.fn(async () => ({ enableHyde: false, rerankProvider: null })),
  MNEMO_SETTING_KEYS: {
    ENABLE_HYDE: "mnemo.enable_hyde",
    RERANK_PROVIDER: "mnemo.rerank_provider",
  },
}));

vi.mock("@/lib/recall-unified", () => ({
  makeKbChunkProvider: vi.fn(() => null),
}));

vi.mock("@/lib/queue", () => ({
  enqueue: mocks.enqueueMock,
  JOB_MNEMO_EMBED_FACT: "mnemo.embed.fact",
}));

vi.mock("@/lib/safe-log", () => ({
  safeLogError: vi.fn(),
  safeLogWarn: vi.fn(),
}));

// agent-runtime pulls llm-call transitively; stub it so the import
// doesn't try to wire real provider calls.
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
let handleMnemosyneRemember: typeof import("@/lib/agent-tools/mnemosyne-remember").handleMnemosyneRemember;

beforeEach(async () => {
  applyPolicyToRecallMock.mockReset();
  applyPolicyToWriteMock.mockReset();
  detectPIIMock.mockReset();
  createFactAsyncMock.mockReset();
  recallUnifiedMock.mockReset();
  getAgentMemoryPolicyMock.mockReset();
  // Default passthrough — individual tests override.
  applyPolicyToRecallMock.mockImplementation((_p, x) => x);
  applyPolicyToWriteMock.mockImplementation((_p, x) => x);

  vi.resetModules();
  ({ buildRecallBlock } = await import("@/lib/agent-runtime"));
  ({ handleMnemosyneRemember } = await import("@/lib/agent-tools/mnemosyne-remember"));
});

/* ───────────────── Recall path: policy narrows scope ───────────────── */

describe("buildRecallBlock — applies agent memory policy", () => {
  it("forwards the loaded policy to applyPolicyToRecall before recallUnified runs", async () => {
    const wsOnlyPolicy = {
      ...DEFAULT_AGENT_MEMORY_POLICY,
      read_scopes: ["workspace"] as const,
    };
    getAgentMemoryPolicyMock.mockResolvedValueOnce(wsOnlyPolicy);
    // The package helper signals scope narrowing by mutating the input.
    applyPolicyToRecallMock.mockImplementationOnce((_p, input) => ({
      ...input,
      scope: "global",
    }));
    recallUnifiedMock.mockResolvedValueOnce([]);

    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "what did we discuss about widgets?",
      history: [],
    });

    expect(applyPolicyToRecallMock).toHaveBeenCalledOnce();
    const [policyArg, inputArg] = applyPolicyToRecallMock.mock.calls[0]!;
    expect(policyArg).toEqual(wsOnlyPolicy);
    expect(inputArg.workspaceId).toBe("ws_1");
    expect(inputArg.agentId).toBe("ag_1");

    // The narrowed input is what reaches recallUnified.
    expect(recallUnifiedMock).toHaveBeenCalledOnce();
    const passed = recallUnifiedMock.mock.calls[0]![0];
    expect(passed.scope).toBe("global");
  });

  it("survives policy load failure by falling back to the DEFAULT policy", async () => {
    // Loader signature: NEVER throws. It returns DEFAULT_AGENT_MEMORY_POLICY
    // on internal failure; this test mirrors that contract.
    getAgentMemoryPolicyMock.mockResolvedValueOnce(DEFAULT_AGENT_MEMORY_POLICY);
    recallUnifiedMock.mockResolvedValueOnce([]);

    await buildRecallBlock({
      workspaceId: "ws_1",
      agentId: "ag_1",
      userTurn: "what did we discuss?",
      history: [],
    });

    expect(applyPolicyToRecallMock).toHaveBeenCalledOnce();
    expect(applyPolicyToRecallMock.mock.calls[0]![0]).toEqual(DEFAULT_AGENT_MEMORY_POLICY);
    expect(recallUnifiedMock).toHaveBeenCalledOnce();
  });
});

/* ───────────────── Write path: PII downgrade ───────────────── */

describe("handleMnemosyneRemember — applies policy to writes", () => {
  it("downgrades scope when a sensitive category intersects detected PII", async () => {
    const sensitivePolicy = {
      ...DEFAULT_AGENT_MEMORY_POLICY,
      sensitive_categories: ["email"],
    };
    getAgentMemoryPolicyMock.mockResolvedValueOnce(sensitivePolicy);
    detectPIIMock.mockReturnValueOnce({
      detected: true,
      categories: ["email"],
      risk_score: 0.7,
      matches: [{ category: "email", match: "lucas@example.com" }],
    });
    // applyPolicyToWrite forces scope to 'global' on PII intersect.
    applyPolicyToWriteMock.mockImplementationOnce((_policy, baseInput, cats) => {
      expect(cats).toContain("email");
      return { ...baseInput, scope: "global" };
    });
    createFactAsyncMock.mockResolvedValueOnce({
      id: "mfact_xyz",
      statement: "user email is lucas@example.com",
    });

    const out = await handleMnemosyneRemember(
      {
        kind: "preference",
        subject: "user",
        statement: "user email is lucas@example.com",
        // Asked for 'team' — but PII downgrades it.
        scope: "team",
      },
      {
        workspaceId: "ws_1",
        agentId: "ag_1",
      }
    );

    expect(out.ok).toBe(true);
    expect(out.factId).toBe("mfact_xyz");
    expect(out.detectedPii).toEqual(["email"]);
    expect(out.scope).toBe("global");
    expect(out.downgraded).toBe(true);

    // Verify the createFactAsync call got the downgraded scope.
    const passedToCreate = createFactAsyncMock.mock.calls[0]![0];
    expect(passedToCreate.scope).toBe("global");
  });

  it("respects the explicit non-global scope when no sensitive PII matches", async () => {
    const policy = {
      ...DEFAULT_AGENT_MEMORY_POLICY,
      sensitive_categories: ["email"],
    };
    getAgentMemoryPolicyMock.mockResolvedValueOnce(policy);
    detectPIIMock.mockReturnValueOnce({
      detected: false,
      categories: [],
      risk_score: 0,
      matches: [],
    });
    // applyPolicyToWrite leaves the explicit caller scope alone (per
    // the package contract: explicit caller scope wins when not 'global').
    applyPolicyToWriteMock.mockImplementationOnce((_policy, baseInput) => baseInput);
    createFactAsyncMock.mockResolvedValueOnce({
      id: "mfact_clean",
      statement: "user prefers TypeScript",
    });

    const out = await handleMnemosyneRemember(
      {
        kind: "preference",
        subject: "user",
        statement: "user prefers TypeScript",
        scope: "conversation",
      },
      {
        workspaceId: "ws_1",
        agentId: "ag_1",
        conversationId: "conv_1",
      }
    );

    expect(out.ok).toBe(true);
    expect(out.detectedPii).toEqual([]);
    expect(out.downgraded).toBe(false);
    // Conversation scope preserved → scopeRef threaded through.
    const passedToCreate = createFactAsyncMock.mock.calls[0]![0];
    expect(passedToCreate.scope).toBe("conversation");
    expect(passedToCreate.scopeRef).toBe("conv_1");
  });
});
