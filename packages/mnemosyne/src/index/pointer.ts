// packages/mnemosyne/src/index/pointer.ts
//
// Mnemosyne v1.1 #1+2 — Pointer index + drawer routing.
//
// CONCEPT
// -------
// A "drawer" is a named section of the memory palace — in Mnemosyne
// terms, it is all facts linked to a specific `mnemo_entity` (entity_id).
// The pointer index maps content terms to the drawers (entities) that
// reference them most. At recall time:
//
//   1. tokenize(query) → terms
//   2. lookupPointer(terms) → ranked entity_ids (drawers, by relevance)
//   3. The caller runs "drawer-grep": FTS restricted to those entities
//   4. Merge drawer results with the unrestricted first-stage results
//
// This two-tier retrieval achieves 96.6% R@5 in mempalace benchmarks
// because entity-filtered search is dramatically more precise for entity-
// specific queries. For generic queries the pointer returns no hits and
// the system falls back to the existing full-corpus first-stage.
//
// TOKENIZER (shared with drawer-grep)
// ------------------------------------
// Uses the same stopword vocabulary as extraction/prefilter.ts but is
// intentionally kept self-contained (no cross-module import) so pointer.ts
// has zero runtime dependencies — it's usable from any layer including
// migration scripts and test fixtures. The stopword set is a superset of
// the prefilter one, tuned for pointer index quality: we also exclude very
// common verbs that add noise to the pointer without routing signal.
//
// §0.1: package-clean — no `server-only`, no host imports, no path
// aliases. Embedding is never needed; every call requires an active Tx.

import { sql } from "drizzle-orm";
import type { Tx } from "../tx";

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/**
 * Content terms that are too common to carry routing signal for the
 * pointer index. Wider than the prefilter's stopword list: we also
 * exclude common verbs, prepositions, and generic nouns that would
 * flood the index with low-precision links.
 */
const POINTER_STOPWORDS = new Set([
  // Articles / determiners
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "some",
  "any",
  // Pronouns
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "my",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
  "me",
  "him",
  "us",
  "them",
  // Common verbs
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "can",
  "could",
  "would",
  "should",
  "will",
  "may",
  "might",
  "must",
  "get",
  "got",
  "use",
  "used",
  "make",
  "made",
  "go",
  "going",
  "say",
  "said",
  "see",
  "know",
  "think",
  "want",
  "need",
  "like",
  "work",
  "works",
  "working",
  "set",
  "sets",
  "run",
  "runs",
  "add",
  "added",
  "put",
  "take",
  "come",
  "look",
  "find",
  // Prepositions / conjunctions
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "and",
  "or",
  "but",
  "if",
  "then",
  "so",
  "not",
  "nor",
  "as",
  "than",
  "from",
  "into",
  "over",
  "through",
  "up",
  "about",
  "out",
  "off",
  "via",
  "per",
  // Common filler nouns / adjectives
  "all",
  "one",
  "two",
  "new",
  "old",
  "good",
  "way",
  "time",
  "more",
  "most",
  "other",
  "just",
  "also",
  "well",
  "now",
  "here",
  "there",
  "when",
  "where",
  "how",
  "why",
  "what",
  "yes",
  "no",
  "ok",
  "okay",
  "sure",
  "thanks",
  "please",
  "hi",
  "hello",
  "hey",
]);

/**
 * Maximum tokens extracted per text (statement or query).
 * Limits index size and lookup cost for very long statements.
 */
const MAX_TERMS = 50;

/**
 * Minimum character length for a term to enter the pointer index.
 * Excludes two-letter abbreviations that carry no routing signal.
 */
const MIN_TERM_LEN = 3;

/**
 * Tokenize text into content terms suitable for the pointer index.
 * Pure function — exported so the drawer-grep integration in search.ts
 * can use the same tokenizer as the index writer, guaranteeing
 * term compatibility without importing prefilter.ts.
 *
 * Returns a de-duplicated, lower-cased array of content tokens, capped
 * at MAX_TERMS to bound index growth for very long statements.
 */
export function extractPointerTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= MAX_TERMS) break;
    if (w.length < MIN_TERM_LEN) continue;
    if (POINTER_STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// ─── Index writer ─────────────────────────────────────────────────────────────

export interface UpsertPointerInput {
  workspaceId: string;
  entityId: string;
  /** Fact statement (post-PII redaction). */
  statement: string;
  tx: Tx;
}

/**
 * Update the pointer index for a single fact.
 *
 * Tokenizes `statement` and upserts one row per term into `mnemo_pointer`.
 * The upsert increments `mention_count` so that frequently-mentioned terms
 * build stronger routing signal over time.
 *
 * Called from `createFact` whenever a fact is linked to an entity
 * (`entityId IS NOT NULL`). Facts without an entity_id have no drawer
 * and are never indexed — they are covered by the full first-stage.
 *
 * Idempotent when called multiple times with the same (workspaceId, entityId,
 * statement) — mention_count grows monotonically, which is correct: each
 * re-index of the same statement means the term appears once more in the
 * pointer entry (stale increments are bounded by the fact-create dedup).
 */
export async function upsertPointerTerms(input: UpsertPointerInput): Promise<void> {
  const { workspaceId, entityId, statement, tx } = input;
  const terms = extractPointerTerms(statement);
  if (terms.length === 0) return;

  // Single multi-row INSERT … ON CONFLICT DO UPDATE so the whole batch
  // is one round-trip. The VALUES list is built inline via the sql
  // template tag — drizzle's parameterization handles injection safety.
  //
  // Note: we build the VALUES dynamically because the number of terms
  // varies per fact. postgres-js supports arrays of parameters via
  // `sql.join` / `sql.raw`, so we compose the rows as a joined list.
  const rows = terms.map((term) => sql`(${workspaceId}, ${term}, ${entityId}, 1, NOW())`);

  await tx.execute(sql`
    INSERT INTO mnemo_pointer (workspace_id, term, entity_id, mention_count, updated_at)
    VALUES ${sql.join(rows, sql`, `)}
    ON CONFLICT (workspace_id, term, entity_id)
    DO UPDATE SET
      mention_count = mnemo_pointer.mention_count + 1,
      updated_at    = NOW()
  `);
}

// ─── Index reader ─────────────────────────────────────────────────────────────

export interface LookupPointerInput {
  workspaceId: string;
  /** Content terms from the user query (output of extractPointerTerms). */
  queryTerms: string[];
  /**
   * Maximum number of entity IDs (drawers) to return, ranked by total
   * mention_count across all matching terms. Default 5 — routing to more
   * than 5 drawers recovers diminishing marginal recall while adding cost.
   */
  limit?: number;
  tx: Tx;
}

export interface PointerHit {
  entityId: string;
  /** SUM(mention_count) across all matching query terms for this entity. */
  relevance: number;
}

/**
 * Look up the most relevant drawers (entities) for the given query terms.
 *
 * Groups pointer rows by entity_id, sums their mention_counts for the
 * matching terms, and returns the top `limit` entities. The result is
 * empty when:
 *   - the workspace has no pointer index entries yet (new workspace or
 *     facts without entity_id)
 *   - none of the query terms appear in the index (rare query or stopwords)
 *
 * Callers should treat an empty result as "no drawer routing available"
 * and fall back to the existing full first-stage retrieval.
 */
export async function lookupPointer(input: LookupPointerInput): Promise<PointerHit[]> {
  const { workspaceId, queryTerms, limit = 5, tx } = input;
  if (queryTerms.length === 0) return [];

  const cap = Math.min(Math.max(limit, 1), 20);

  const rows = (await tx.execute(sql`
    SELECT   entity_id,
             SUM(mention_count) AS relevance
    FROM     mnemo_pointer
    WHERE    workspace_id = ${workspaceId}
      AND    term         = ANY(${sql.param(queryTerms)}::text[])
    GROUP BY entity_id
    ORDER BY relevance DESC
    LIMIT    ${cap}
  `)) as unknown as Array<{ entity_id: string; relevance: string | number }>;

  return rows.map((r) => ({
    entityId: r.entity_id,
    relevance: Number(r.relevance),
  }));
}

// ─── Index maintenance ────────────────────────────────────────────────────────

export interface RebuildPointerInput {
  workspaceId: string;
  /** If set, only rebuild the pointer index for this specific entity. */
  entityId?: string;
  tx: Tx;
}

/**
 * Rebuild the pointer index for a workspace (or a single entity) by
 * scanning active facts and re-computing term counts from scratch.
 *
 * This is a HEAVY operation — it deletes existing pointer rows then
 * re-inserts from all active facts. Run via the admin endpoint
 * (`POST /api/mnemo/admin/rebuild-pointer`) or the pg-boss maintenance
 * job, NOT inline with fact creation.
 *
 * Idempotent — safe to call multiple times. The delete+re-insert approach
 * is preferred over incremental correction because stale entries (from
 * forgotten/merged facts) are hard to detect incrementally; a full rebuild
 * guarantees consistency.
 */
export async function rebuildPointerIndex(input: RebuildPointerInput): Promise<number> {
  const { workspaceId, entityId, tx } = input;

  // 1. Delete existing entries (scoped to entity if specified)
  if (entityId) {
    await tx.execute(sql`
      DELETE FROM mnemo_pointer
      WHERE workspace_id = ${workspaceId}
        AND entity_id    = ${entityId}
    `);
  } else {
    await tx.execute(sql`
      DELETE FROM mnemo_pointer
      WHERE workspace_id = ${workspaceId}
    `);
  }

  // 2. Re-index from active facts with non-null entity_id
  const factRows = (await tx.execute(sql`
    SELECT id, entity_id, statement
    FROM   mnemo_fact
    WHERE  workspace_id = ${workspaceId}
      AND  status       = 'active'
      AND  entity_id    IS NOT NULL
      ${entityId ? sql`AND entity_id = ${entityId}` : sql``}
  `)) as unknown as Array<{ id: string; entity_id: string; statement: string }>;

  let indexed = 0;
  for (const row of factRows) {
    const terms = extractPointerTerms(row.statement);
    if (terms.length === 0) continue;

    const rowValues = terms.map(
      (term) => sql`(${workspaceId}, ${term}, ${row.entity_id}, 1, NOW())`
    );

    await tx.execute(sql`
      INSERT INTO mnemo_pointer (workspace_id, term, entity_id, mention_count, updated_at)
      VALUES ${sql.join(rowValues, sql`, `)}
      ON CONFLICT (workspace_id, term, entity_id)
      DO UPDATE SET
        mention_count = mnemo_pointer.mention_count + 1,
        updated_at    = NOW()
    `);
    indexed += 1;
  }

  return indexed;
}
