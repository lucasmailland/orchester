// packages/mnemosyne/src/benchmark/fixtures.ts
//
// v1.1 #29 — LongMemEval benchmark fixtures.
//
// Synthetic test scenarios inspired by the LongMemEval benchmark
// (Wu et al., EMNLP 2024 — https://arxiv.org/abs/2410.10813).
//
// Five question categories from the paper:
//   1. single_session_preference  — durable user preference stated once.
//   2. single_session_habit       — recurring user behaviour pattern.
//   3. multi_session_update       — information that changed across sessions.
//   4. temporal_reasoning         — when did event X happen?
//   5. absent_content             — question about info that was NEVER mentioned.
//
// Each fixture defines:
//   • The conversation turns to insert (as fake mnemo_facts).
//   • The query the agent would receive from the user.
//   • Ground-truth fact IDs that a correct recall MUST surface.
//   • Accepted answer phrases for answer-coverage scoring.
//   • The question category string.
//
// These fixtures drive the integration benchmark in
// `tests/benchmark/longmemeval.spec.ts` but are also importable
// for standalone regression testing in CI.

import type { GroundTruth } from "./metrics";
import type { FactKind, FactScope } from "../primitives/fact";

// ── Fixture type ──────────────────────────────────────────────────────────────

export interface BenchmarkFact {
  id: string;
  kind: FactKind;
  scope: FactScope;
  subject: string;
  statement: string;
  /**
   * Relative age in days (0 = inserted now; positive = days ago).
   * Used by the benchmark runner to set `valid_from` so recency signals
   * are realistic.
   */
  ageDays?: number;
}

export interface BenchmarkQuestion {
  id: string;
  category:
    | "single_session_preference"
    | "single_session_habit"
    | "multi_session_update"
    | "temporal_reasoning"
    | "absent_content";
  description: string;
  /** Facts to insert into the workspace before running the query. */
  setupFacts: BenchmarkFact[];
  /** Facts that should NOT appear in the result set (distractor facts). */
  distractorFacts?: BenchmarkFact[];
  /** The recall query. */
  query: string;
  truth: GroundTruth;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

export const BENCHMARK_QUESTIONS: BenchmarkQuestion[] = [
  // ── 1. Single-session preference ─────────────────────────────────────────

  {
    id: "lme-001",
    category: "single_session_preference",
    description: "Recall explicit language preference stated once",
    setupFacts: [
      {
        id: "f-lme-001-a",
        kind: "preference",
        scope: "global",
        subject: "user",
        statement: "The user prefers TypeScript over JavaScript for all new projects",
        ageDays: 14,
      },
    ],
    distractorFacts: [
      {
        id: "f-lme-001-d1",
        kind: "preference",
        scope: "global",
        subject: "user",
        statement: "The user prefers dark mode in their IDE",
        ageDays: 10,
      },
    ],
    query: "What programming language does the user prefer?",
    truth: {
      factIds: ["f-lme-001-a"],
      acceptedAnswers: ["TypeScript", "typescript"],
    },
  },

  {
    id: "lme-002",
    category: "single_session_preference",
    description: "Recall database preference with comparison",
    setupFacts: [
      {
        id: "f-lme-002-a",
        kind: "preference",
        scope: "global",
        subject: "user",
        statement:
          "The user prefers PostgreSQL over MySQL because of its JSON support and extensions",
        ageDays: 7,
      },
    ],
    query: "Which database does the user like to use?",
    truth: {
      factIds: ["f-lme-002-a"],
      acceptedAnswers: ["PostgreSQL", "postgres"],
    },
  },

  // ── 2. Single-session habit ───────────────────────────────────────────────

  {
    id: "lme-003",
    category: "single_session_habit",
    description: "Recall recurring standup time habit",
    setupFacts: [
      {
        id: "f-lme-003-a",
        kind: "trait",
        scope: "global",
        subject: "user",
        statement: "The user always attends the team standup at 9:30 AM every weekday",
        ageDays: 21,
      },
      {
        id: "f-lme-003-b",
        kind: "trait",
        scope: "global",
        subject: "user",
        statement: "The user prefers morning slots for focused work, usually before noon",
        ageDays: 18,
      },
    ],
    query: "When does the user have their standup meeting?",
    truth: {
      factIds: ["f-lme-003-a"],
      acceptedAnswers: ["9:30", "9:30 AM"],
    },
  },

  {
    id: "lme-004",
    category: "single_session_habit",
    description: "Recall work-from-home pattern",
    setupFacts: [
      {
        id: "f-lme-004-a",
        kind: "trait",
        scope: "global",
        subject: "user",
        statement: "The user works from home on Mondays and Fridays",
        ageDays: 30,
      },
    ],
    distractorFacts: [
      {
        id: "f-lme-004-d1",
        kind: "trait",
        scope: "global",
        subject: "user",
        statement: "The user commutes to the office by bicycle",
        ageDays: 25,
      },
    ],
    query: "Which days does the user work remotely?",
    truth: {
      factIds: ["f-lme-004-a"],
      acceptedAnswers: ["Monday", "Friday", "Mondays and Fridays"],
    },
  },

  // ── 3. Multi-session update (knowledge change) ────────────────────────────

  {
    id: "lme-005",
    category: "multi_session_update",
    description: "Recall updated team membership after role change",
    setupFacts: [
      // Old fact (should be superseded / lower relevance)
      {
        id: "f-lme-005-old",
        kind: "relationship",
        scope: "global",
        subject: "user",
        statement: "The user was a member of the frontend team",
        ageDays: 60,
      },
      // New fact (should rank higher via recency)
      {
        id: "f-lme-005-new",
        kind: "relationship",
        scope: "global",
        subject: "user",
        statement: "The user joined the platform team after a role change two weeks ago",
        ageDays: 14,
      },
    ],
    query: "Which team does the user currently belong to?",
    truth: {
      factIds: ["f-lme-005-new"],
      acceptedAnswers: ["platform team", "platform"],
    },
  },

  {
    id: "lme-006",
    category: "multi_session_update",
    description: "Recall updated city of residence",
    setupFacts: [
      {
        id: "f-lme-006-old",
        kind: "trait",
        scope: "global",
        subject: "user",
        statement: "The user lives in Buenos Aires",
        ageDays: 90,
      },
      {
        id: "f-lme-006-new",
        kind: "trait",
        scope: "global",
        subject: "user",
        statement: "The user relocated to Barcelona last month",
        ageDays: 28,
      },
    ],
    query: "Where does the user currently live?",
    truth: {
      factIds: ["f-lme-006-new"],
      acceptedAnswers: ["Barcelona", "barcelona"],
    },
  },

  // ── 4. Temporal reasoning ─────────────────────────────────────────────────

  {
    id: "lme-007",
    category: "temporal_reasoning",
    description: "Recall when a project milestone occurred",
    setupFacts: [
      {
        id: "f-lme-007-a",
        kind: "event",
        scope: "global",
        subject: "project",
        statement: "The project went live to production on 2026-03-15",
        ageDays: 75,
      },
    ],
    query: "When did the project launch to production?",
    truth: {
      factIds: ["f-lme-007-a"],
      acceptedAnswers: ["2026-03-15", "March 15", "15 March"],
    },
  },

  // ── 5. Absent content (should return empty / low-score results) ───────────

  {
    id: "lme-008",
    category: "absent_content",
    description: "Query about information never mentioned — correct answer is no recall",
    setupFacts: [
      {
        id: "f-lme-008-d1",
        kind: "preference",
        scope: "global",
        subject: "user",
        statement: "The user prefers concise responses over verbose ones",
        ageDays: 10,
      },
    ],
    query: "What is the user's annual salary?",
    // For absent-content, ground truth has empty factIds — the metric
    // measures whether the system correctly returns nothing rather than
    // hallucinating a match from the distractor facts.
    truth: {
      factIds: [],
      acceptedAnswers: [],
    },
  },
];

/** Lookup a fixture by id. */
export function getFixture(id: string): BenchmarkQuestion | undefined {
  return BENCHMARK_QUESTIONS.find((q) => q.id === id);
}

/** Return all fixtures matching a category. */
export function fixturesByCategory(category: BenchmarkQuestion["category"]): BenchmarkQuestion[] {
  return BENCHMARK_QUESTIONS.filter((q) => q.category === category);
}
