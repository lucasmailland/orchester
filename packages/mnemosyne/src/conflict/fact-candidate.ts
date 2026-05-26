// packages/mnemosyne/src/conflict/fact-candidate.ts
//
// Candidate-on-write for facts (v1.1, parallel to conflict/candidate.ts).
//
// Decisions get topic_key + revision_count baked in at the schema layer.
// Facts have no topic_key — two contradictory "user prefers X" / "user
// prefers Y" rows can coexist silently. This module surfaces potential
// contradictions on each write so the caller (LLM judge in Mode C, queue
// for human review in Mode A/B) can decide whether to update, supersede,
// or accept both as scoped.
//
// Strategy:
//   1. FTS over existing active facts in the workspace via
//      `text_lemmatized @@ plainto_tsquery('simple', statement)`.
//   2. Also surface any fact sharing the exact `subject` value (cheap
//      string match, catches the "user prefers X" → "user prefers Y"
//      case which FTS alone would miss when the statements share no
//      content tokens).
//   3. Top-N candidates ranked by `ts_rank_cd`.
//
// Unlike conflict/candidate.ts (decisions), we do NOT auto-insert pending
// relation rows here — facts are higher-volume and the relation table
// would explode. The caller decides what to do with candidates.

import { sql } from "drizzle-orm";
import {
  createFact,
  type CreateFactInput,
  type FactKind,
  type MnemoFact,
} from "../primitives/fact";
import { enqueueReview } from "../review/queue";

export interface FactCandidate {
  candidate: Pick<MnemoFact, "id" | "subject" | "statement" | "kind" | "confidence">;
  /** FTS rank from ts_rank_cd, raw (not normalized). 0 when the candidate
   *  was surfaced only via exact-subject match without FTS overlap. */
  similarity: number;
  reason: "same_subject" | "fts_similar";
}

export interface SaveFactWithCandidatesOutput {
  newFact: MnemoFact;
  candidates: FactCandidate[];
  judgmentRequired: boolean;
  /**
   * v1.3 active-learning hook. Set when `judgmentRequired` flipped to
   * true AND the caller opted into `enqueueOnNoJudge` (i.e. Mode A/B
   * with no LLM judge available). The host UI surfaces this row in
   * the Memory Inspector queue.
   *
   * Null when `enqueueOnNoJudge` was false or judgment was not
   * required.
   */
  enqueuedReviewId: string | null;
}

export type SaveFactWithCandidatesInput = CreateFactInput & {
  /**
   * Minimum `ts_rank_cd` for an FTS hit to count as a "real" candidate
   * that flips `judgmentRequired` to true. Same-subject hits always
   * count regardless of this threshold. Default 0.05.
   */
  ftsThreshold?: number;
  /** Max candidates returned. Default 5. */
  candidateLimit?: number;
  /**
   * v1.3: when true AND `judgmentRequired` ends up true, enqueue a
   * `mnemo_review_queue` row (reason='contradiction') so a human
   * triages the contradiction. Hosts in Mode C (LLM judge available)
   * leave this false and resolve via the judge instead. Default
   * false to keep the legacy callers (extraction pipeline) unchanged.
   */
  enqueueOnNoJudge?: boolean;
};

const FTS_THRESHOLD_DEFAULT = 0.05;
const CANDIDATE_LIMIT_DEFAULT = 5;

/**
 * Save a fact and surface potential contradictions. Does NOT mutate
 * any existing fact — the caller (LLM judge / human reviewer) decides
 * what to do with candidates.
 */
export async function saveFactWithCandidates(
  input: SaveFactWithCandidatesInput
): Promise<SaveFactWithCandidatesOutput> {
  // 1. Insert the new fact first (with PII redaction + embedding via
  //    createFact). We search AFTER insertion so the new row is excluded
  //    via `id != $newId` rather than relying on an open transaction
  //    bookkeeping flag.
  const newFact = await createFact(input);

  const threshold = input.ftsThreshold ?? FTS_THRESHOLD_DEFAULT;
  const limit = input.candidateLimit ?? CANDIDATE_LIMIT_DEFAULT;

  // 2. FTS + same-subject query, ranked by ts_rank_cd (0 for
  //    subject-only hits). We OR the two predicates so a row that
  //    matches both (same subject AND FTS hit) shows up once with its
  //    real rank.
  const rows = (await input.tx.execute(sql`
    SELECT
      id,
      subject,
      statement,
      kind,
      confidence,
      CASE
        WHEN text_lemmatized IS NOT NULL
          THEN ts_rank_cd(text_lemmatized, plainto_tsquery('simple', ${input.statement}))
        ELSE 0
      END AS similarity,
      (subject = ${input.subject}) AS subject_match
    FROM mnemo_fact
    WHERE workspace_id = ${input.workspaceId}
      AND status = 'active'
      AND id != ${newFact.id}
      AND (
        subject = ${input.subject}
        OR text_lemmatized @@ plainto_tsquery('simple', ${input.statement})
      )
    ORDER BY
      (subject = ${input.subject}) DESC,
      similarity DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    subject: string;
    statement: string;
    kind: FactKind;
    confidence: number;
    similarity: number;
    subject_match: boolean;
  }>;

  const candidates: FactCandidate[] = rows.map((r) => ({
    candidate: {
      id: r.id,
      subject: r.subject,
      statement: r.statement,
      kind: r.kind,
      confidence: r.confidence,
    },
    similarity: r.similarity ?? 0,
    reason: r.subject_match ? "same_subject" : "fts_similar",
  }));

  // 3. judgmentRequired iff at least one candidate is either (a) same
  //    subject as the new fact or (b) above the FTS threshold. A loose
  //    FTS hit with low rank doesn't force a judgment cycle.
  const judgmentRequired = candidates.some(
    (c) => c.reason === "same_subject" || c.similarity > threshold
  );

  // 4. v1.3 active-learning enqueue. When the host opted in
  //    (`enqueueOnNoJudge: true`, typical for Mode A/B with no LLM
  //    judge configured) AND we surfaced a real contradiction, queue
  //    a `mnemo_review_queue` row so a human triages it. The dedup
  //    inside `enqueueReview` makes this safe to call repeatedly.
  let enqueuedReviewId: string | null = null;
  if (input.enqueueOnNoJudge && judgmentRequired) {
    const r = await enqueueReview({
      workspaceId: input.workspaceId,
      factId: newFact.id,
      reason: "contradiction",
      tx: input.tx,
    });
    enqueuedReviewId = r.id;
  }

  return { newFact, candidates, judgmentRequired, enqueuedReviewId };
}
