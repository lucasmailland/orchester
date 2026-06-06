/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Phase 3 dead test (covers the legacy library path).
// apps/web/tests/unit/brain/episode-extractor.spec.ts
//
// Mnemosyne v1.5 F1 — verifies the episode synthesizer.
//
// Contracts under test:
//   1. When the slice mentions a meeting + date + participants, the
//      LLM returns `worthCreating: true` and the synthesizer calls
//      `createEpisode` with the extracted metadata.
//   2. Every fact id passed in is wired through to `linkFactToEpisode`.
//   3. When the LLM returns `worthCreating: false`, NEITHER write
//      function is called — the synthesizer silently drops the
//      candidate.
//   4. Non-JSON LLM output returns null without crashing the parent
//      caller (best-effort posture).

import { describe, it, expect, vi, beforeEach } from "vitest";

// Restore real schema so types resolve. The synthesizer doesn't touch
// the DB directly (writes go via createEpisode/linkFactToEpisode which
// are mocked), but the type imports still need a non-empty schema.
vi.mock("@orchester/db", async () => {
  const actual = await vi.importActual<typeof import("@orchester/db")>("@orchester/db");
  return {
    ...actual,
    getDb: vi.fn(() => ({})),
  };
});

const createEpisodeMock = vi.fn();
const linkFactToEpisodeMock = vi.fn();
const assertWithinSpendMock = vi.fn().mockResolvedValue(undefined);
const recordAiUsageMock = vi.fn().mockResolvedValue(undefined);
const safeLogErrorMock = vi.fn();

vi.mock("@mnemosyne/core", async () => {
  const actual = await vi.importActual<typeof import("@mnemosyne/core")>("@mnemosyne/core");
  return {
    ...actual,
    createEpisode: createEpisodeMock,
    linkFactToEpisode: linkFactToEpisodeMock,
  };
});
vi.mock("@/lib/cost-alerts", () => ({ assertWithinSpend: assertWithinSpendMock }));
vi.mock("@/lib/ai/run", () => ({ recordAiUsage: recordAiUsageMock }));
vi.mock("@/lib/safe-log", () => ({
  safeLogError: safeLogErrorMock,
  safeLogWarn: vi.fn(),
}));
vi.mock("@/lib/pricing", () => ({ calculateChatCostUsd: vi.fn(() => 0.001) }));
vi.mock("@/lib/agent-runtime", () => ({
  wrapUntrusted: (s: string, _ctx: string) => s,
}));

const txFixture = {
  execute: vi.fn().mockResolvedValue(undefined),
};

describe("extractEpisode", () => {
  beforeEach(() => {
    createEpisodeMock.mockReset();
    linkFactToEpisodeMock.mockReset();
    assertWithinSpendMock.mockClear();
    recordAiUsageMock.mockClear();
    safeLogErrorMock.mockReset();
    txFixture.execute.mockClear();
    createEpisodeMock.mockResolvedValue({
      id: "mepi_test",
      title: "Q2 planning",
      narrative: "Team met to plan Q2",
      occurredAt: new Date("2026-04-15"),
      durationMinutes: 60,
      participants: ["Alice", "Bob"],
      topics: ["Q2 OKRs", "hiring"],
      linkedFactIds: ["mfact_a", "mfact_b"],
      sourceConversationId: "conv_meeting",
      metadata: {},
      workspaceId: "ws_meeting",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("creates an episode + links facts when the LLM returns worthCreating=true", async () => {
    const llmCall = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        worthCreating: true,
        title: "Q2 planning meeting",
        narrative: "Team met to plan Q2 priorities.",
        occurred_at: "2026-04-15T14:00:00.000Z",
        duration_minutes: 60,
        participants: ["Alice", "Bob"],
        topics: ["Q2 OKRs", "hiring"],
      }),
      tokensUsed: 120,
      model: "claude-haiku-4-5",
    });

    const { extractEpisode } = await import("@/lib/brain/episode-extractor");

    const candidate = await extractEpisode({
      workspaceId: "ws_meeting",
      conversationId: "conv_meeting",
      agentId: "ag_meeting",
      conversationSlice:
        "user: We have the Q2 planning meeting tomorrow at 2pm. " +
        "Alice and Bob will be there. We need to discuss OKRs and hiring.",
      factIds: ["mfact_a", "mfact_b"],
      model: "claude-haiku-4-5",
      llm: llmCall,
      tx: txFixture as never,
    });

    // Spend guard fired before the LLM call.
    expect(assertWithinSpendMock).toHaveBeenCalledTimes(1);
    // Metering fired after the LLM call.
    expect(recordAiUsageMock).toHaveBeenCalledTimes(1);

    expect(candidate).not.toBeNull();
    expect(candidate!.worthCreating).toBe(true);
    expect(candidate!.title).toBe("Q2 planning meeting");

    // The episode row was written.
    expect(createEpisodeMock).toHaveBeenCalledTimes(1);
    const createArg = createEpisodeMock.mock.calls[0]![0] as {
      title: string;
      participants: string[];
      topics: string[];
      linkedFactIds: string[];
      sourceConversationId: string;
    };
    expect(createArg.title).toBe("Q2 planning meeting");
    expect(createArg.participants).toEqual(["Alice", "Bob"]);
    expect(createArg.topics).toEqual(["Q2 OKRs", "hiring"]);
    expect(createArg.linkedFactIds).toEqual(["mfact_a", "mfact_b"]);
    expect(createArg.sourceConversationId).toBe("conv_meeting");

    // Both facts were linked.
    expect(linkFactToEpisodeMock).toHaveBeenCalledTimes(2);
  });

  it("drops the candidate silently when worthCreating=false", async () => {
    const llmCall = vi.fn().mockResolvedValue({
      content: JSON.stringify({ worthCreating: false }),
      tokensUsed: 30,
      model: "claude-haiku-4-5",
    });

    const { extractEpisode } = await import("@/lib/brain/episode-extractor");

    const candidate = await extractEpisode({
      workspaceId: "ws_chat",
      conversationId: "conv_chat",
      agentId: "ag_chat",
      conversationSlice: "user: hey, how are you? assistant: doing well!",
      factIds: ["mfact_x"],
      model: "claude-haiku-4-5",
      llm: llmCall,
      tx: txFixture as never,
    });

    expect(candidate).not.toBeNull();
    expect(candidate!.worthCreating).toBe(false);
    expect(createEpisodeMock).not.toHaveBeenCalled();
    expect(linkFactToEpisodeMock).not.toHaveBeenCalled();
  });

  it("returns null on non-JSON LLM output without throwing", async () => {
    const llmCall = vi.fn().mockResolvedValue({
      content: "I am not JSON, I am a sentence.",
      tokensUsed: 10,
      model: "claude-haiku-4-5",
    });

    const { extractEpisode } = await import("@/lib/brain/episode-extractor");

    const candidate = await extractEpisode({
      workspaceId: "ws_garbage",
      conversationId: "conv_garbage",
      agentId: "ag_garbage",
      conversationSlice: "some random conversation",
      factIds: [],
      model: "claude-haiku-4-5",
      llm: llmCall,
      tx: txFixture as never,
    });

    expect(candidate).toBeNull();
    expect(createEpisodeMock).not.toHaveBeenCalled();
    // Metering still recorded — the tokens were burnt.
    expect(recordAiUsageMock).toHaveBeenCalledTimes(1);
  });
});
