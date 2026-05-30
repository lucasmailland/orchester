// packages/mnemosyne/src/benchmark/metrics.ts
//
// v1.1 #29 — LongMemEval evaluation metrics.
//
// Pure functions — no DB, no network. Computes standard IR metrics:
// Recall@K, Precision@K, F1@K, MRR, and the LongMemEval-specific
// "Answer Coverage" score (does the recalled text contain the answer?).
//
// Reference: LongMemEval paper §4 (EMNLP 2024, Wu et al.)
// https://arxiv.org/abs/2410.10813

// ── Types ─────────────────────────────────────────────────────────────────────

/** Ground truth answer for a single benchmark question. */
export interface GroundTruth {
  /**
   * IDs of the facts that must appear in the top-K results for a correct
   * recall. A question is correctly recalled if AT LEAST ONE groundTruth
   * fact id appears in the top-K hits.
   */
  factIds: string[];
  /**
   * Verbatim answer text (or key phrases) used for answer-coverage scoring.
   * Multiple accepted phrasings can be listed — a hit covers the answer if
   * ANY of these strings are present (case-insensitive substring match).
   */
  acceptedAnswers: string[];
}

/** A single evaluated recall result. */
export interface EvalHit {
  factId: string;
  /** Statement text of the retrieved fact. */
  text: string;
  /** Retrieval rank (1 = top result). */
  rank: number;
}

/** Per-question evaluation result. */
export interface QuestionResult {
  questionId: string;
  /** True if any groundTruth factId appears in the top-K hits. */
  hitAtK: boolean;
  /** The rank of the first groundTruth hit (null if not found in top-K). */
  firstHitRank: number | null;
  /** Fraction of top-K hits that are in groundTruth.factIds. */
  precisionAtK: number;
  /** Fraction of groundTruth.factIds found in top-K. */
  recallAtK: number;
  /** Harmonic mean of precisionAtK and recallAtK. */
  f1AtK: number;
  /** Whether the recalled text (any hit) contains an accepted answer phrase. */
  answerCoverage: boolean;
}

/** Aggregate benchmark results across all questions. */
export interface BenchmarkResult {
  /** Total number of evaluated questions. */
  totalQuestions: number;
  /** Top-K used for per-question metrics. */
  k: number;
  /** Macro-averaged Recall@K across all questions. */
  recallAtK: number;
  /** Macro-averaged Precision@K across all questions. */
  precisionAtK: number;
  /** Macro-averaged F1@K across all questions. */
  f1AtK: number;
  /** Fraction of questions where any hit contained an accepted answer. */
  answerCoverage: number;
  /** Mean Reciprocal Rank (MRR). */
  mrr: number;
  /**
   * Per-category metrics (keyed by the question category string).
   * Useful for diagnosing which question types the pipeline handles poorly.
   */
  byCategory: Record<string, CategoryMetrics>;
  /** Per-question detail (for inspection / debugging). */
  perQuestion: QuestionResult[];
}

export interface CategoryMetrics {
  count: number;
  recallAtK: number;
  precisionAtK: number;
  f1AtK: number;
  answerCoverage: number;
  mrr: number;
}

// ── Core metric functions ─────────────────────────────────────────────────────

/**
 * Evaluate a single question given the top-K retrieved hits and ground truth.
 * Pure function — safe to call in any context.
 */
export function evaluateQuestion(
  questionId: string,
  hits: EvalHit[],
  truth: GroundTruth,
  k: number
): QuestionResult {
  const topK = hits.slice(0, k);
  const truthSet = new Set(truth.factIds);
  const hitTexts = topK.map((h) => h.text.toLowerCase());

  // Hit@K — any relevant fact in top-K.
  const relevantHits = topK.filter((h) => truthSet.has(h.factId));
  const hitAtK = relevantHits.length > 0;

  // First-hit rank (1-based; null if no relevant fact in top-K).
  const firstHitRank = hitAtK ? Math.min(...relevantHits.map((h) => h.rank)) : null;

  // Precision@K — fraction of top-K that are relevant.
  const precisionAtK = topK.length > 0 ? relevantHits.length / topK.length : 0;

  // Recall@K — fraction of relevant facts found in top-K.
  const recallAtK = truth.factIds.length > 0 ? relevantHits.length / truth.factIds.length : 0;

  // F1@K.
  const f1AtK =
    precisionAtK + recallAtK > 0 ? (2 * precisionAtK * recallAtK) / (precisionAtK + recallAtK) : 0;

  // Answer coverage — does any top-K hit contain an accepted answer phrase?
  const answerCoverage = truth.acceptedAnswers.some((answer) =>
    hitTexts.some((text) => text.includes(answer.toLowerCase()))
  );

  return {
    questionId,
    hitAtK,
    firstHitRank,
    precisionAtK,
    recallAtK,
    f1AtK,
    answerCoverage,
  };
}

/**
 * Compute per-category metrics from a list of question results.
 * Pure function.
 */
export function computeCategoryMetrics(
  results: Array<QuestionResult & { category: string }>
): Record<string, CategoryMetrics> {
  const groups = new Map<string, Array<QuestionResult & { category: string }>>();
  for (const r of results) {
    const g = groups.get(r.category) ?? [];
    g.push(r);
    groups.set(r.category, g);
  }

  const out: Record<string, CategoryMetrics> = {};
  for (const [cat, catResults] of groups) {
    const n = catResults.length;
    const avg = (fn: (r: QuestionResult) => number) =>
      catResults.reduce((s, r) => s + fn(r), 0) / n;

    out[cat] = {
      count: n,
      recallAtK: avg((r) => r.recallAtK),
      precisionAtK: avg((r) => r.precisionAtK),
      f1AtK: avg((r) => r.f1AtK),
      answerCoverage: avg((r) => (r.answerCoverage ? 1 : 0)),
      mrr: avg((r) => (r.firstHitRank !== null ? 1 / r.firstHitRank : 0)),
    };
  }
  return out;
}

/**
 * Aggregate per-question results into a full BenchmarkResult.
 * Pure function.
 */
export function aggregateResults(
  results: Array<QuestionResult & { category: string }>,
  k: number
): BenchmarkResult {
  const n = results.length;
  if (n === 0) {
    return {
      totalQuestions: 0,
      k,
      recallAtK: 0,
      precisionAtK: 0,
      f1AtK: 0,
      answerCoverage: 0,
      mrr: 0,
      byCategory: {},
      perQuestion: [],
    };
  }

  const avg = (fn: (r: QuestionResult) => number) => results.reduce((s, r) => s + fn(r), 0) / n;

  return {
    totalQuestions: n,
    k,
    recallAtK: avg((r) => r.recallAtK),
    precisionAtK: avg((r) => r.precisionAtK),
    f1AtK: avg((r) => r.f1AtK),
    answerCoverage: avg((r) => (r.answerCoverage ? 1 : 0)),
    mrr: avg((r) => (r.firstHitRank !== null ? 1 / r.firstHitRank : 0)),
    byCategory: computeCategoryMetrics(results),
    perQuestion: results,
  };
}

/**
 * Format a BenchmarkResult as a compact human-readable report string.
 * Useful for CI output and the test reporter.
 */
export function formatBenchmarkReport(result: BenchmarkResult): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [
    `LongMemEval benchmark — ${result.totalQuestions} questions  K=${result.k}`,
    `  Recall@${result.k}    : ${pct(result.recallAtK)}`,
    `  Precision@${result.k} : ${pct(result.precisionAtK)}`,
    `  F1@${result.k}        : ${pct(result.f1AtK)}`,
    `  AnswerCoverage: ${pct(result.answerCoverage)}`,
    `  MRR           : ${result.mrr.toFixed(3)}`,
    "",
    "  By category:",
  ];
  for (const [cat, m] of Object.entries(result.byCategory)) {
    lines.push(
      `    ${cat.padEnd(30)} n=${m.count}  R@K=${pct(m.recallAtK)}  MRR=${m.mrr.toFixed(3)}`
    );
  }
  return lines.join("\n");
}
