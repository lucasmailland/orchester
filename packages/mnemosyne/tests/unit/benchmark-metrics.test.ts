// packages/mnemosyne/tests/unit/benchmark-metrics.test.ts
//
// Unit tests for #29 — LongMemEval benchmark metrics engine.
// Pure-function tests — no DB, no network.

import { describe, it, expect } from "vitest";
import {
  evaluateQuestion,
  aggregateResults,
  formatBenchmarkReport,
} from "../../src/benchmark/metrics";
import { BENCHMARK_QUESTIONS, fixturesByCategory, getFixture } from "../../src/benchmark/fixtures";
import type { EvalHit, GroundTruth, QuestionResult } from "../../src/benchmark/metrics";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeHit(factId: string, text: string, rank: number): EvalHit {
  return { factId, text, rank };
}

type CatResult = QuestionResult & { category: string };

function makeResult(overrides: Partial<CatResult> = {}): CatResult {
  return {
    questionId: "q1",
    hitAtK: true,
    firstHitRank: 1,
    precisionAtK: 1.0,
    recallAtK: 1.0,
    f1AtK: 1.0,
    answerCoverage: true,
    category: "single_session_preference",
    ...overrides,
  };
}

// ── evaluateQuestion ──────────────────────────────────────────────────────────

describe("evaluateQuestion (#29)", () => {
  const truth: GroundTruth = {
    factIds: ["f1", "f2"],
    acceptedAnswers: ["TypeScript", "TS"],
  };

  it("hitAtK=true when relevant fact is in top-K", () => {
    const hits = [makeHit("f1", "The user prefers TypeScript", 1)];
    const result = evaluateQuestion("q1", hits, truth, 5);
    expect(result.hitAtK).toBe(true);
    expect(result.firstHitRank).toBe(1);
  });

  it("hitAtK=false when no relevant fact in top-K", () => {
    const hits = [makeHit("f99", "Unrelated fact text", 1)];
    const result = evaluateQuestion("q1", hits, truth, 5);
    expect(result.hitAtK).toBe(false);
    expect(result.firstHitRank).toBeNull();
  });

  it("Precision@K = relevant_in_topK / K", () => {
    const hits = [
      makeHit("f1", "relevant", 1), // in truth
      makeHit("f99", "noise", 2), // not in truth
    ];
    const result = evaluateQuestion("q1", hits, truth, 2);
    expect(result.precisionAtK).toBeCloseTo(0.5); // 1 relevant out of 2 hits
  });

  it("Recall@K = relevant_in_topK / total_relevant", () => {
    const hits = [makeHit("f1", "The user prefers TypeScript", 1)];
    // truth has 2 relevant facts (f1, f2) — only f1 found → recall = 0.5
    const result = evaluateQuestion("q1", hits, truth, 5);
    expect(result.recallAtK).toBeCloseTo(0.5);
  });

  it("F1@K = harmonic mean of P@K and R@K", () => {
    const hits = [makeHit("f1", "relevant", 1), makeHit("f2", "also relevant", 2)];
    const result = evaluateQuestion("q1", hits, truth, 2);
    // Both relevant facts found: P=1.0, R=1.0 → F1=1.0
    expect(result.f1AtK).toBeCloseTo(1.0);
  });

  it("answerCoverage=true when accepted answer is in hit text (case-insensitive)", () => {
    const hits = [makeHit("f1", "user prefers typescript for new work", 1)];
    const result = evaluateQuestion("q1", hits, truth, 5);
    expect(result.answerCoverage).toBe(true);
  });

  it("answerCoverage=false when no hit contains any accepted answer", () => {
    const hits = [makeHit("f1", "user works from home on Fridays", 1)];
    const result = evaluateQuestion("q1", hits, truth, 5);
    expect(result.answerCoverage).toBe(false);
  });

  it("absent-content: empty truth factIds gives hitAtK=false and precision=0", () => {
    const absentTruth: GroundTruth = { factIds: [], acceptedAnswers: [] };
    const hits = [makeHit("f1", "some unrelated fact", 1)];
    const result = evaluateQuestion("q1", hits, absentTruth, 5);
    // No relevant facts → hit=false, precision=0, recall trivially 0/0=0
    expect(result.hitAtK).toBe(false);
    expect(result.precisionAtK).toBeCloseTo(0);
    expect(result.recallAtK).toBeCloseTo(0);
  });

  it("respects K — only considers top-K hits", () => {
    const hits = [
      makeHit("f99", "noise 1", 1),
      makeHit("f99", "noise 2", 2),
      makeHit("f1", "relevant", 3), // relevant BUT at rank 3, K=2 → not counted
    ];
    const result = evaluateQuestion("q1", hits, truth, 2);
    expect(result.hitAtK).toBe(false);
  });
});

// ── aggregateResults ──────────────────────────────────────────────────────────

describe("aggregateResults (#29)", () => {
  it("returns zero metrics for empty input", () => {
    const r = aggregateResults([], 5);
    expect(r.totalQuestions).toBe(0);
    expect(r.recallAtK).toBe(0);
    expect(r.mrr).toBe(0);
  });

  it("macro-averages recall correctly", () => {
    const results = [
      makeResult({ recallAtK: 1.0 }),
      makeResult({ recallAtK: 0.5, questionId: "q2" }),
    ];
    const r = aggregateResults(results, 5);
    expect(r.recallAtK).toBeCloseTo(0.75);
  });

  it("MRR = mean of 1/rank (0 when not found)", () => {
    const results = [
      makeResult({ firstHitRank: 1 }), // 1/1 = 1.0
      makeResult({ firstHitRank: 2, questionId: "q2" }), // 1/2 = 0.5
      makeResult({ firstHitRank: null, hitAtK: false, questionId: "q3" }), // 0
    ];
    const r = aggregateResults(results, 5);
    expect(r.mrr).toBeCloseTo((1.0 + 0.5 + 0.0) / 3);
  });

  it("groups by category correctly", () => {
    const results = [
      makeResult({ category: "single_session_preference", recallAtK: 1.0 }),
      makeResult({ category: "single_session_preference", recallAtK: 0.5, questionId: "q2" }),
      makeResult({ category: "temporal_reasoning", recallAtK: 0.0, questionId: "q3" }),
    ];
    const r = aggregateResults(results, 5);
    expect(r.byCategory["single_session_preference"]?.count).toBe(2);
    expect(r.byCategory["single_session_preference"]?.recallAtK).toBeCloseTo(0.75);
    expect(r.byCategory["temporal_reasoning"]?.recallAtK).toBeCloseTo(0.0);
  });
});

// ── formatBenchmarkReport ─────────────────────────────────────────────────────

describe("formatBenchmarkReport (#29)", () => {
  it("returns a non-empty string", () => {
    const result = aggregateResults([makeResult()], 5);
    const report = formatBenchmarkReport(result);
    expect(report.length).toBeGreaterThan(0);
    expect(report).toContain("LongMemEval");
  });

  it("includes the K value", () => {
    const result = aggregateResults([makeResult()], 3);
    const report = formatBenchmarkReport(result);
    expect(report).toContain("K=3");
  });

  it("includes category breakdown", () => {
    const result = aggregateResults(
      [makeResult({ category: "temporal_reasoning", questionId: "q1" })],
      5
    );
    const report = formatBenchmarkReport(result);
    expect(report).toContain("temporal_reasoning");
  });
});

// ── fixtures ──────────────────────────────────────────────────────────────────

describe("BENCHMARK_QUESTIONS fixtures (#29)", () => {
  it("has at least 8 questions", () => {
    expect(BENCHMARK_QUESTIONS.length).toBeGreaterThanOrEqual(8);
  });

  it("covers all 5 LongMemEval categories", () => {
    const categories = new Set(BENCHMARK_QUESTIONS.map((q) => q.category));
    expect(categories.has("single_session_preference")).toBe(true);
    expect(categories.has("single_session_habit")).toBe(true);
    expect(categories.has("multi_session_update")).toBe(true);
    expect(categories.has("temporal_reasoning")).toBe(true);
    expect(categories.has("absent_content")).toBe(true);
  });

  it("each question has at least one setup fact", () => {
    for (const q of BENCHMARK_QUESTIONS) {
      expect(q.setupFacts.length).toBeGreaterThan(0);
    }
  });

  it("absent_content questions have empty factIds in truth", () => {
    const absent = fixturesByCategory("absent_content");
    for (const q of absent) {
      expect(q.truth.factIds).toHaveLength(0);
    }
  });

  it("non-absent questions have at least one ground truth fact id", () => {
    const nonAbsent = BENCHMARK_QUESTIONS.filter((q) => q.category !== "absent_content");
    for (const q of nonAbsent) {
      expect(q.truth.factIds.length).toBeGreaterThan(0);
    }
  });

  it("getFixture returns correct question by id", () => {
    const q = getFixture("lme-001");
    expect(q).toBeDefined();
    expect(q?.category).toBe("single_session_preference");
  });

  it("getFixture returns undefined for unknown id", () => {
    expect(getFixture("nonexistent")).toBeUndefined();
  });

  it("all fact ids within a question are unique", () => {
    for (const q of BENCHMARK_QUESTIONS) {
      const allIds = [
        ...q.setupFacts.map((f) => f.id),
        ...(q.distractorFacts ?? []).map((f) => f.id),
      ];
      const unique = new Set(allIds);
      expect(unique.size).toBe(allIds.length);
    }
  });
});
