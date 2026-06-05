// apps/web/tests/unit/brain/extract-job-sensitivity.spec.ts
//
// Mnemosyne v1.5 F1 — verifies the early-skip path when
// `conversation.memory_learning_paused = true`. The contract under test
// is: when the conversation row carries `memoryLearningPaused: true`,
// `runBrainExtractJob` must:
//
//   1. NOT call `extractFacts` (no LLM dispatch — no spend).
//   2. NOT call `saveFactWithCandidates` (no facts written).
//   3. NOT call `extractEpisode` (no episode synthesized).
//   4. Mark the brain_extraction_job row as
//      state='skipped_sensitivity' + skipReason='memory_learning_paused'.
//
// Each external dependency is mocked. The test asserts the
// SHAPE of the calls (the conv lookup happens; the LLM is never
// touched), not the actual DB state.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vitest.setup.ts mocks `schema` to {} for the global suite, which
// strips `schema.conversations.id` etc. Override locally so the
// drizzle .select({ id: schema.conversations.id }) compiles + runs.
vi.mock("@orchester/db", async () => {
  const actual = await vi.importActual<typeof import("@orchester/db")>("@orchester/db");
  return {
    ...actual,
    getDb: vi.fn(() => ({})),
  };
});

const extractFactsMock = vi.fn();
const saveFactWithCandidatesMock = vi.fn();
const extractEpisodeMock = vi.fn();
const resolveSmallTierModelMock = vi.fn();
const withMnemoTxMock = vi.fn(async (_wsId: string, fn: (tx: unknown) => Promise<unknown>) =>
  fn({})
);
const invalidateRecallCacheMock = vi.fn();
const appendAuditMock = vi.fn();

// Snapshot the call ledger for state changes — every update we make to
// brain_extraction_job goes through this single mock, so we can assert
// what set() was called with.
const updateSetCalls: Array<Record<string, unknown>> = [];
const conversationRowFixture = {
  id: "conv_paused",
  employeeId: null,
  memoryLearningPaused: true,
};

const txFixture = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([conversationRowFixture]),
        orderBy: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((patch: Record<string, unknown>) => {
      updateSetCalls.push(patch);
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
    }),
  })),
};

vi.mock("@/lib/tenant/cron", () => ({
  withCrossTenantAdmin: vi.fn(async (_label: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(txFixture)
  ),
}));

vi.mock("@/lib/audit/log", () => ({
  appendAudit: appendAuditMock,
}));

vi.mock("@/lib/safe-log", () => ({
  safeLogError: vi.fn(),
  safeLogWarn: vi.fn(),
}));

vi.mock("@orchester/mnemosyne", () => ({
  getProviderHealth: vi.fn(() => ({ samples: [] })),
  recordProviderResult: vi.fn(),
  resolveActiveMode: vi.fn().mockResolvedValue({ active: "C", degraded: false }),
  resolveConfiguredMode: vi.fn(() => "C"),
  saveFactWithCandidates: saveFactWithCandidatesMock,
  withMnemoTx: withMnemoTxMock,
  shouldExtract: vi.fn(() => ({ yes: true, reason: "mock" })),
}));

vi.mock("@/lib/brain/model-resolve", () => ({
  resolveSmallTierModel: resolveSmallTierModelMock,
}));

vi.mock("@/lib/brain/extract", () => ({
  extractFacts: extractFactsMock,
}));

vi.mock("@/lib/brain/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brain/store")>("@/lib/brain/store");
  return {
    ...actual,
    withBrainTx: vi.fn(async (_wsId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(txFixture)
    ),
  };
});

vi.mock("@/lib/brain/recall", () => ({
  invalidateRecallCache: invalidateRecallCacheMock,
}));

vi.mock("@/lib/brain/episode-extractor", () => ({
  extractEpisode: extractEpisodeMock,
}));

vi.mock("@/lib/llm-call", () => ({
  llmCall: vi.fn(),
}));

describe("runBrainExtractJob — sensitivity gate", () => {
  beforeEach(() => {
    extractFactsMock.mockReset();
    saveFactWithCandidatesMock.mockReset();
    extractEpisodeMock.mockReset();
    resolveSmallTierModelMock.mockReset();
    invalidateRecallCacheMock.mockReset();
    appendAuditMock.mockReset();
    updateSetCalls.length = 0;
    // Provide a fast-tier model so the only reason to skip is the gate.
    resolveSmallTierModelMock.mockResolvedValue({
      modelId: "claude-haiku-4-5",
      providerId: "anthropic",
    });
  });

  it("skips when memoryLearningPaused=true: no LLM call, no facts, state='skipped_sensitivity'", async () => {
    const { runBrainExtractJob } = await import("@/lib/brain/extract-job");

    await runBrainExtractJob({
      jobId: "bext_test1",
      workspaceId: "ws_paused",
      conversationId: "conv_paused",
      agentId: "ag_paused",
    });

    // No fact extraction
    expect(extractFactsMock).not.toHaveBeenCalled();
    // No fact save
    expect(saveFactWithCandidatesMock).not.toHaveBeenCalled();
    // No episode synthesis
    expect(extractEpisodeMock).not.toHaveBeenCalled();
    // No model resolution either — the gate fires before model lookup.

    // The job row update reflects skipped_sensitivity.
    const skipUpdate = updateSetCalls.find((u) => u.state === "skipped_sensitivity");
    expect(skipUpdate).toBeDefined();
    expect(skipUpdate?.skipReason).toBe("memory_learning_paused");
    expect(skipUpdate?.factsProduced).toBe(0);
  });
});
