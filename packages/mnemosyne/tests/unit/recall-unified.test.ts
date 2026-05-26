// packages/mnemosyne/tests/unit/recall-unified.test.ts
//
// Unit-level coverage for `recallUnified`. We mock `searchMnemo` so
// this stays pure (no DB). Validates:
//   1. memory-only path (no kbProvider) — passes searchMnemo hits
//      through untouched, with source='memory'.
//   2. blended path — both sources merged, scores in [0, 1].
//   3. KB normalization — raw KB scores normalized against the max.
//   4. KB provider failure is degraded to memory-only.
//   5. memory weight + kb weight defaults blend at 0.6 / 0.4.

import { describe, it, expect, vi, beforeEach } from "vitest";

const searchMnemoMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/recall/search", () => ({
  searchMnemo: searchMnemoMock,
}));

// Imported AFTER the mock so the unified module sees the mocked impl.
import { recallUnified } from "../../src/recall/unified";
import type { KbChunkProvider } from "../../src/recall/unified";

function makeMemoryHit(id: string, score: number, statement: string) {
  return {
    fact: {
      id,
      workspaceId: "ws_test",
      agentId: null,
      scope: "global" as const,
      scopeRef: null,
      kind: "preference" as const,
      subject: "user",
      statement,
      confidence: 0.7,
      pinned: false,
      relevance: 1.0,
      hitCount: 0,
      lastRecalledAt: null,
      sourceMessageIds: [],
      attributedTo: null,
      linkedMemoryIds: [],
      embedding: null,
      metadata: {},
      status: "active" as const,
      mergedIntoId: null,
      validFrom: new Date(),
      validTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      memoryType: "semantic" as const,
      actorId: null,
    },
    score,
    reasons: { semantic: 0, recency: 0, frequency: 0, relevance: 0, pin: 0 },
  };
}

beforeEach(() => {
  searchMnemoMock.mockReset();
});

describe("recallUnified — memory-only path", () => {
  it("returns memory hits when no kbProvider", async () => {
    searchMnemoMock.mockResolvedValueOnce([
      makeMemoryHit("mfact_a", 0.9, "prefers TS"),
      makeMemoryHit("mfact_b", 0.5, "lives in Buenos Aires"),
    ]);

    const out = await recallUnified({
      workspaceId: "ws_test",
      query: "what does the user prefer",
    });

    expect(out).toHaveLength(2);
    expect(out[0]!.source).toBe("memory");
    // memoryWeight default 0.6 → 0.9 * 0.6 = 0.54
    expect(out[0]!.score).toBeCloseTo(0.54, 5);
    expect(out[0]!.content).toBe("prefers TS");
    expect(out[0]!.metadata.kind).toBe("preference");
  });

  it("returns empty array when memory has no hits and no kbProvider", async () => {
    searchMnemoMock.mockResolvedValueOnce([]);
    const out = await recallUnified({
      workspaceId: "ws_test",
      query: "anything",
    });
    expect(out).toEqual([]);
  });
});

describe("recallUnified — blended path", () => {
  it("merges memory + KB hits with normalized KB scores", async () => {
    searchMnemoMock.mockResolvedValueOnce([makeMemoryHit("mfact_a", 0.9, "prefers TS")]);
    const kbProvider: KbChunkProvider = {
      async search() {
        return [
          {
            id: "kc_1",
            content: "TypeScript is a superset of JavaScript",
            score: 100, // raw provider score, gets normalized
            source: { docId: "doc_1", docTitle: "TS Handbook" },
          },
          {
            id: "kc_2",
            content: "React supports hooks",
            score: 50,
            source: { docId: "doc_2", docTitle: "React Docs" },
          },
        ];
      },
    };

    const out = await recallUnified({
      workspaceId: "ws_test",
      query: "what does the user prefer",
      kbProvider,
    });

    expect(out.length).toBeGreaterThanOrEqual(2);
    const memHit = out.find((h) => h.source === "memory");
    const kbHit1 = out.find((h) => h.id === "kc_1");
    const kbHit2 = out.find((h) => h.id === "kc_2");
    expect(memHit?.score).toBeCloseTo(0.54, 5); // 0.9 * 0.6
    // kbWeight default 0.4. Normalized 100/100 = 1.0 → 0.4. 50/100 = 0.5 → 0.2.
    expect(kbHit1?.score).toBeCloseTo(0.4, 5);
    expect(kbHit2?.score).toBeCloseTo(0.2, 5);
    expect(kbHit1?.metadata.docTitle).toBe("TS Handbook");
  });

  it("respects custom memoryWeight + kbWeight", async () => {
    searchMnemoMock.mockResolvedValueOnce([makeMemoryHit("mfact_a", 0.8, "x")]);
    const kbProvider: KbChunkProvider = {
      async search() {
        return [
          {
            id: "kc_1",
            content: "y",
            score: 0.7,
            source: { docId: "doc_1", docTitle: "T" },
          },
        ];
      },
    };

    const out = await recallUnified({
      workspaceId: "ws_test",
      query: "q",
      memoryWeight: 0.3,
      kbWeight: 0.7,
      kbProvider,
    });

    const memHit = out.find((h) => h.source === "memory")!;
    const kbHit = out.find((h) => h.source === "kb")!;
    expect(memHit.score).toBeCloseTo(0.24, 5); // 0.8 * 0.3
    expect(kbHit.score).toBeCloseTo(0.7, 5); // 0.7 * (0.7/0.7) → normalized 1.0 * 0.7
  });
});

describe("recallUnified — degradation", () => {
  it("falls back to memory-only when KB provider throws", async () => {
    searchMnemoMock.mockResolvedValueOnce([makeMemoryHit("mfact_a", 0.9, "x")]);
    const kbProvider: KbChunkProvider = {
      async search() {
        throw new Error("KB exploded");
      },
    };

    const out = await recallUnified({
      workspaceId: "ws_test",
      query: "q",
      kbProvider,
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("memory");
  });

  it("re-throws when searchMnemo fails (memory failure is real)", async () => {
    searchMnemoMock.mockRejectedValueOnce(new Error("DB exploded"));
    await expect(recallUnified({ workspaceId: "ws_test", query: "q" })).rejects.toThrow(
      "DB exploded"
    );
  });
});

describe("recallUnified — topK + sort", () => {
  it("caps the merged set at topK and sorts desc by score", async () => {
    searchMnemoMock.mockResolvedValueOnce([
      makeMemoryHit("mfact_a", 0.9, "a"),
      makeMemoryHit("mfact_b", 0.3, "b"),
      makeMemoryHit("mfact_c", 0.7, "c"),
    ]);
    const kbProvider: KbChunkProvider = {
      async search() {
        return [
          { id: "kc_1", content: "k1", score: 0.5, source: { docId: "d", docTitle: "T" } },
          { id: "kc_2", content: "k2", score: 0.9, source: { docId: "d", docTitle: "T" } },
        ];
      },
    };

    const out = await recallUnified({
      workspaceId: "ws_test",
      query: "q",
      topK: 3,
      kbProvider,
    });

    expect(out).toHaveLength(3);
    // Sorted desc
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.score).toBeGreaterThanOrEqual(out[i]!.score);
    }
  });

  it("clamps topK to [1, 20]", async () => {
    searchMnemoMock.mockResolvedValueOnce([makeMemoryHit("mfact_a", 0.9, "x")]);
    // topK=0 → coerced to 1
    const out = await recallUnified({
      workspaceId: "ws_test",
      query: "q",
      topK: 0,
    });
    expect(out.length).toBeLessThanOrEqual(1);
  });
});

describe("recallUnified — pass-through to searchMnemo", () => {
  it("forwards actorId, agentId, history, and HyDE opts", async () => {
    searchMnemoMock.mockResolvedValueOnce([]);
    const history = [{ role: "user" as const, content: "earlier turn" }];
    await recallUnified({
      workspaceId: "ws_test",
      query: "q",
      agentId: "agent_a",
      actorId: "user_lucas",
      enableHyDE: true,
      enableContextualize: false,
      history,
    });
    expect(searchMnemoMock).toHaveBeenCalledTimes(1);
    const passed = searchMnemoMock.mock.calls[0]![0];
    expect(passed.agentId).toBe("agent_a");
    expect(passed.actorId).toBe("user_lucas");
    expect(passed.enableHyDE).toBe(true);
    expect(passed.enableContextualize).toBe(false);
    expect(passed.history).toBe(history);
  });
});
