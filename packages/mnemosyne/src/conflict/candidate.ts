// packages/mnemosyne/src/conflict/candidate.ts
//
// Candidate-on-write loop (spec §7). When a decision is saved with
// checkConflicts != 'none', we run FTS over existing active decisions in
// the same workspace to surface potential conflicts. Each candidate gets a
// pending relation inserted; the relation IDs become the judgmentIds the
// caller (agent or human) must resolve later.
//
// FTS strategy: OR-joined quoted tokens via `to_tsquery('simple', …)`.
// This is intentionally looser than `plainto_tsquery` (which ANDs every
// token) because candidate-on-write is meant to over-recall — false
// positives become judge-pending edges, false negatives silently lose
// conflict surfacing.
//
// §0.1: package-clean — no `server-only`, no path aliases.
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";
import { createDecision, type MnemoDecision, type DecisionKind } from "../primitives/decision";
import { createRelation, type MnemoRelation } from "../graph/relation";

export type ConflictCheckLevel = "none" | "fast" | "thorough";

export interface SaveDecisionInput {
  workspaceId: string;
  agentId?: string | null;
  conversationId?: string | null;
  kind: DecisionKind;
  title: string;
  body: string;
  topicKey?: string | null;
  decidedByUserId?: string | null;
  metadata?: Record<string, unknown>;
  checkConflicts?: ConflictCheckLevel;
  /** Candidate FTS limit. Default 3. */
  candidateLimit?: number;
  tx: Tx;
}

export interface SaveDecisionResult {
  decision: MnemoDecision;
  judgmentRequired: boolean;
  candidates: Array<{
    id: string;
    title: string;
    kind: DecisionKind;
    /** Pending relation row ID — the agent/human resolves this row via
     *  judgeRelation() with the actual verb. */
    judgmentId: string;
  }>;
}

const FTS_CANDIDATE_LIMIT_DEFAULT = 3;

/**
 * Sanitize free text into a `to_tsquery('simple', …)` payload. Each
 * alphanumeric token is wrapped in double quotes and joined with " | "
 * (the tsquery OR operator — the SQL keyword `OR` is not valid inside
 * tsquery; the plan's first draft hit `syntax error in tsquery` and we
 * corrected it here).
 *
 * Why quoted-OR instead of `plainto_tsquery`:
 *   - plainto_tsquery ANDs every token, which over-filters (a 5-word
 *     title rarely matches a 5-word query exactly).
 *   - Quoted-OR is permissive: any matching token surfaces the row.
 *   - False positives become pending relations the agent judges, which
 *     is the intended behavior (better to over-recall conflicts than
 *     to silently miss them).
 *
 * Empty / no-token input returns "''" (empty tsquery, matches nothing).
 */
function sanitizeFTSCandidates(text: string): string {
  const tokens = text.match(/[A-Za-z0-9]+/g) ?? [];
  if (tokens.length === 0) return "''";
  return tokens.map((t) => `"${t}"`).join(" | ");
}

export async function saveDecisionWithCandidates(
  input: SaveDecisionInput
): Promise<SaveDecisionResult> {
  // 1. Save the decision (handles topic_key upsert too).
  const decision = await createDecision(input);

  // 2. Short-circuit when caller opts out of conflict scanning.
  if (input.checkConflicts === "none") {
    return { decision, judgmentRequired: false, candidates: [] };
  }

  // 3. Build FTS query from title + first 100 chars of body. Truncating
  //    body keeps the tsquery small and biases toward distinctive lead-in
  //    tokens (which usually carry the topic).
  const query = sanitizeFTSCandidates(`${input.title} ${input.body.slice(0, 100)}`);
  const limit = input.candidateLimit ?? FTS_CANDIDATE_LIMIT_DEFAULT;

  // 4. Run FTS search excluding the just-saved row.
  const fts = await input.tx.execute(sql`
    SELECT id, title, kind
    FROM mnemo_decision
    WHERE workspace_id = ${input.workspaceId}
      AND status = 'active'
      AND id != ${decision.id}
      AND text_lemmatized @@ to_tsquery('simple', ${query})
    ORDER BY ts_rank_cd(text_lemmatized, to_tsquery('simple', ${query})) DESC
    LIMIT ${limit}
  `);
  const rows = fts as unknown as Array<{
    id: string;
    title: string;
    kind: DecisionKind;
  }>;

  if (rows.length === 0) {
    return { decision, judgmentRequired: false, candidates: [] };
  }

  // 5. Insert one pending relation per candidate (new decision → candidate).
  //    Verb starts as 'related' (placeholder) — the judge call later
  //    refines to the actual relationship.
  const candidates: SaveDecisionResult["candidates"] = [];
  for (const row of rows) {
    const rel: MnemoRelation = await createRelation({
      workspaceId: input.workspaceId,
      sourceKind: "decision",
      sourceId: decision.id,
      targetKind: "decision",
      targetId: row.id,
      relation: "related",
      judgmentStatus: "pending",
      markedByKind: "system",
      conversationId: input.conversationId ?? null,
      tx: input.tx,
    });
    candidates.push({
      id: row.id,
      title: row.title,
      kind: row.kind,
      judgmentId: rel.id,
    });
  }

  return {
    decision,
    judgmentRequired: true,
    candidates,
  };
}
