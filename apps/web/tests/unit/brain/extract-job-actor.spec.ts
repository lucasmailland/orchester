// apps/web/tests/unit/brain/extract-job-actor.spec.ts
//
// Mnemosyne v1.5 F1 — verifies the `actor_id` pass-through.
//
// Contract: when the conversation row has `employee_id` set, every
// fact saved via `saveFactWithCandidates` MUST receive
// `actorId: <employeeId>`. When `employee_id` is NULL, `actorId`
// passes through as `null` (workspace-shared, legacy behaviour).

import { describe, it, expect, vi, beforeEach } from "vitest";

// Restore the real @orchester/db so schema.conversations.id is defined.
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

const updateSetCalls: Array<Record<string, unknown>> = [];

// Per-test override of the conv row so we can swap employee ids.
let convRow: {
  id: string;
  employeeId: string | null;
  memoryLearningPaused: boolean;
} = {
  id: "conv_actor",
  employeeId: "emp_lucas",
  memoryLearningPaused: false,
};

const txFixture = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([convRow]),
        orderBy: vi.fn(() => ({
          limit: vi
            .fn()
            .mockResolvedValue([
              { id: "msg1", role: "user", content: "hi", createdAt: new Date() },
            ]),
        })),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((patch: Record<string, unknown>) => {
      updateSetCalls.push(patch);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
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

describe("runBrainExtractJob — actor_id pass-through", () => {
  beforeEach(() => {
    extractFactsMock.mockReset();
    saveFactWithCandidatesMock.mockReset();
    extractEpisodeMock.mockReset();
    resolveSmallTierModelMock.mockReset();
    updateSetCalls.length = 0;
    resolveSmallTierModelMock.mockResolvedValue({
      modelId: "claude-haiku-4-5",
      providerId: "anthropic",
    });
    // The extractor returns one fact; the loop sends it through to
    // saveFactWithCandidates.
    extractFactsMock.mockResolvedValue([
      {
        kind: "preference",
        subject: "lucas",
        statement: "prefers TypeScript over JavaScript",
        confidence: 0.8,
        memoryType: "semantic",
        attribution: "user_stated",
      },
    ]);
    saveFactWithCandidatesMock.mockResolvedValue({
      newFact: { id: "mfact_actor" },
      candidates: [],
      judgmentRequired: false,
      enqueuedReviewId: null,
    });
  });

  it("passes employee_id as actor_id when the conversation has one", async () => {
    convRow = {
      id: "conv_actor",
      employeeId: "emp_lucas",
      memoryLearningPaused: false,
    };

    const { runBrainExtractJob } = await import("@/lib/brain/extract-job");
    await runBrainExtractJob({
      jobId: "bext_actor1",
      workspaceId: "ws_actor",
      conversationId: "conv_actor",
      agentId: "ag_actor",
    });

    expect(saveFactWithCandidatesMock).toHaveBeenCalledTimes(1);
    const call = saveFactWithCandidatesMock.mock.calls[0]![0] as { actorId: string | null };
    expect(call.actorId).toBe("emp_lucas");
  });

  it("passes actorId=null when the conversation has no employee", async () => {
    convRow = {
      id: "conv_noactor",
      employeeId: null,
      memoryLearningPaused: false,
    };

    // Reset module cache so the dynamic import picks up the new convRow.
    vi.resetModules();
    const { runBrainExtractJob } = await import("@/lib/brain/extract-job");
    await runBrainExtractJob({
      jobId: "bext_actor2",
      workspaceId: "ws_actor",
      conversationId: "conv_noactor",
      agentId: "ag_actor",
    });

    expect(saveFactWithCandidatesMock).toHaveBeenCalledTimes(1);
    const call = saveFactWithCandidatesMock.mock.calls[0]![0] as { actorId: string | null };
    expect(call.actorId).toBeNull();
  });
});
