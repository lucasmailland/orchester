// apps/web/tests/unit/brain/extract-job-classification.spec.ts
//
// Mnemosyne v1.5 F1 — verifies the LLM-driven cognitive classification
// flows through to the stored fact.
//
// Contract: when `extractFacts` returns a fact with
// `memoryType: 'episodic'` and `attribution: 'user_stated'`, the
// `saveFactWithCandidates` call MUST receive both values verbatim.

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const convRow = {
  id: "conv_classify",
  employeeId: "emp_actor",
  memoryLearningPaused: false,
};

const txFixture = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([convRow]),
        orderBy: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "msg1",
              role: "user",
              content: "we met on 2026-04-15",
              createdAt: new Date(),
            },
          ]),
        })),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  })),
};

vi.mock("@/lib/tenant/cron", () => ({
  withCrossTenantAdmin: vi.fn(async (_label: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(txFixture)
  ),
}));
vi.mock("@/lib/audit/log", () => ({ appendAudit: vi.fn() }));
vi.mock("@/lib/safe-log", () => ({ safeLogError: vi.fn(), safeLogWarn: vi.fn() }));
vi.mock("@mnemosyne/core", () => ({
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
vi.mock("@/lib/brain/extract", () => ({ extractFacts: extractFactsMock }));
vi.mock("@/lib/brain/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brain/store")>("@/lib/brain/store");
  return {
    ...actual,
    withBrainTx: vi.fn(async (_wsId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(txFixture)
    ),
  };
});
vi.mock("@/lib/brain/recall", () => ({ invalidateRecallCache: vi.fn() }));
vi.mock("@/lib/brain/episode-extractor", () => ({ extractEpisode: extractEpisodeMock }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn() }));

describe("runBrainExtractJob — LLM classification flow-through", () => {
  beforeEach(() => {
    extractFactsMock.mockReset();
    saveFactWithCandidatesMock.mockReset();
    extractEpisodeMock.mockReset();
    resolveSmallTierModelMock.mockReset();
    resolveSmallTierModelMock.mockResolvedValue({
      modelId: "claude-haiku-4-5",
      providerId: "anthropic",
    });
    saveFactWithCandidatesMock.mockResolvedValue({
      newFact: { id: "mfact_classify" },
      candidates: [],
      judgmentRequired: false,
      enqueuedReviewId: null,
    });
  });

  it("stores memoryType + attribution exactly as the LLM classified them", async () => {
    extractFactsMock.mockResolvedValue([
      {
        kind: "event",
        subject: "team",
        statement: "had a planning meeting on 2026-04-15",
        confidence: 0.9,
        memoryType: "episodic",
        attribution: "user_stated",
      },
    ]);

    const { runBrainExtractJob } = await import("@/lib/brain/extract-job");
    await runBrainExtractJob({
      jobId: "bext_classify1",
      workspaceId: "ws_classify",
      conversationId: "conv_classify",
      agentId: "ag_classify",
    });

    expect(saveFactWithCandidatesMock).toHaveBeenCalledTimes(1);
    const arg = saveFactWithCandidatesMock.mock.calls[0]![0] as {
      memoryType: string;
      attribution: string;
    };
    expect(arg.memoryType).toBe("episodic");
    expect(arg.attribution).toBe("user_stated");
  });

  it("defaults to memoryType='semantic' + attribution='inferred' when the LLM omits them", async () => {
    extractFactsMock.mockResolvedValue([
      {
        kind: "preference",
        subject: "lucas",
        statement: "prefers cold brew",
        confidence: 0.7,
        // Note: memoryType + attribution omitted from the extracted
        // fact (legacy/Mode-A path). The job MUST default both to
        // the safe values that match the SQL DEFAULT.
      },
    ]);

    vi.resetModules();
    const { runBrainExtractJob } = await import("@/lib/brain/extract-job");
    await runBrainExtractJob({
      jobId: "bext_classify2",
      workspaceId: "ws_classify",
      conversationId: "conv_classify",
      agentId: "ag_classify",
    });

    expect(saveFactWithCandidatesMock).toHaveBeenCalledTimes(1);
    const arg = saveFactWithCandidatesMock.mock.calls[0]![0] as {
      memoryType: string;
      attribution: string;
    };
    expect(arg.memoryType).toBe("semantic");
    expect(arg.attribution).toBe("inferred");
  });
});
