// packages/mnemosyne/src/benchmark/index.ts
//
// v1.1 #29 — LongMemEval benchmark public barrel.
// Re-exports the metrics engine and fixtures so host-side benchmark
// runners can import without touching internal paths.

export {
  evaluateQuestion,
  computeCategoryMetrics,
  aggregateResults,
  formatBenchmarkReport,
  type GroundTruth,
  type EvalHit,
  type QuestionResult,
  type BenchmarkResult,
  type CategoryMetrics,
} from "./metrics";

export {
  BENCHMARK_QUESTIONS,
  getFixture,
  fixturesByCategory,
  type BenchmarkQuestion,
  type BenchmarkFact,
} from "./fixtures";
