// packages/mnemosyne/src/review/queue.ts
//
// Mnemosyne v1.3 — active-learning review queue helpers.
//
// `mnemo_review_queue` (migration 0032) is the persistent queue of
// facts that need a human pass. Two distinct producers, one consumer:
//
//   • `saveFactWithCandidates` (Mode A/B path) calls `enqueueReview`
//     with reason='contradiction' when judgmentRequired flips to true
//     and the host has no LLM judge to auto-resolve.
//   • The `review-sweep` cron (apps/web/worker/review-sweep-job.ts)
//     enqueues low-confidence inactive facts daily with
//     reason='low_confidence'.
//
// Consumer is the Inspector UI (v1.3 D2/D3) calling
// `GET /api/mnemo/review` and resolving via
// `POST /api/mnemo/review/[id]/resolve`.
//
// §0.1: package-clean — no host imports, no `server-only`. Every call
// requires an active `Tx` so RLS+FORCE Pattern A applies.
import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";

export type ReviewReason = "low_confidence" | "contradiction" | "manual";

export interface EnqueueReviewInput {
  workspaceId: string;
  factId: string;
  reason: ReviewReason;
  tx: Tx;
}

export interface EnqueueReviewResult {
  /** ID of the queued row, OR the pre-existing open row id if a
   *  duplicate-suppression hit. */
  id: string;
  /** True iff a fresh row was inserted. False when an open queue row
   *  already targeted this (workspace, fact) pair. */
  inserted: boolean;
}

/**
 * Insert a review-queue row, but DO NOT duplicate an existing open
 * row for the same `(workspace_id, fact_id)`. The two producers
 * (saveFactWithCandidates, review-sweep cron) can race: a fact saved
 * with judgmentRequired in the morning and then swept as
 * low-confidence in the evening should not produce two rows. The
 * partial index `idx_mnemo_review_queue_workspace_unresolved`
 * (resolved_at IS NULL) keeps this check on a small hot index.
 *
 * Suppression is by (workspace_id, fact_id, resolved_at IS NULL).
 * The earlier `reason` wins — the cron's later visit silently no-ops
 * rather than overwriting a richer contradiction signal.
 */
export async function enqueueReview(input: EnqueueReviewInput): Promise<EnqueueReviewResult> {
  const { workspaceId, factId, reason, tx } = input;

  // Suppression read: a single index hop via the partial index. We
  // run this inside the same tx as the insert so a concurrent
  // enqueue can't slip through — Postgres serializable behaviour
  // under RLS+FORCE is enough here (the row count is tiny and the
  // race window is microseconds; no need for a heavier lock).
  const existing = await tx
    .select({ id: schema.mnemoReviewQueue.id })
    .from(schema.mnemoReviewQueue)
    .where(
      and(
        eq(schema.mnemoReviewQueue.workspaceId, workspaceId),
        eq(schema.mnemoReviewQueue.factId, factId),
        isNull(schema.mnemoReviewQueue.resolvedAt)
      )
    )
    .limit(1);

  const prev = existing[0];
  if (prev) return { id: prev.id, inserted: false };

  const id = `mrev_${createId()}`;
  await tx.insert(schema.mnemoReviewQueue).values({
    id,
    workspaceId,
    factId,
    reason,
  });
  return { id, inserted: true };
}

export interface ListReviewInput {
  workspaceId: string;
  /** Filter by reason. Omit to get all reasons. */
  reason?: ReviewReason;
  /** When true, include resolved rows. Defaults to false (queue
   *  only). */
  includeResolved?: boolean;
  limit?: number;
  tx: Tx;
}

export interface ReviewQueueRow {
  id: string;
  workspaceId: string;
  factId: string;
  reason: ReviewReason;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolution: "kept" | "edited" | "forgotten" | "dismissed" | null;
}

/**
 * List queue rows for the workspace, newest first. Defaults to the
 * unresolved subset — pass `includeResolved: true` to see the full
 * history.
 */
export async function listReview(input: ListReviewInput): Promise<ReviewQueueRow[]> {
  const { workspaceId, reason, includeResolved = false, limit = 50, tx } = input;
  const cap = Math.min(Math.max(limit, 1), 200);
  const rows = (await tx.execute(sql`
    SELECT id, workspace_id, fact_id, reason,
           created_at, resolved_at, resolved_by, resolution
    FROM mnemo_review_queue
    WHERE workspace_id = ${workspaceId}
      ${includeResolved ? sql`` : sql`AND resolved_at IS NULL`}
      ${reason ? sql`AND reason = ${reason}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${cap}
  `)) as unknown as Array<{
    id: string;
    workspace_id: string;
    fact_id: string;
    reason: ReviewReason;
    created_at: Date;
    resolved_at: Date | null;
    resolved_by: string | null;
    resolution: "kept" | "edited" | "forgotten" | "dismissed" | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    factId: r.fact_id,
    reason: r.reason,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    resolvedAt: r.resolved_at
      ? r.resolved_at instanceof Date
        ? r.resolved_at
        : new Date(r.resolved_at)
      : null,
    resolvedBy: r.resolved_by,
    resolution: r.resolution,
  }));
}

export type ReviewResolution = "kept" | "edited" | "forgotten" | "dismissed";

export interface ResolveReviewInput {
  workspaceId: string;
  reviewId: string;
  resolvedByUserId: string;
  resolution: ReviewResolution;
  tx: Tx;
}

export interface ResolveReviewResult {
  /** True when an open row was resolved. False when the row was
   *  already resolved (idempotent re-resolve) or doesn't exist. */
  resolved: boolean;
  /** The fact_id of the row (so the route handler can cascade to
   *  forgetFact / edit / etc.). NULL when the row doesn't exist. */
  factId: string | null;
}

/**
 * Resolve a queue row. Updates `resolved_at + resolved_by + resolution`
 * atomically; the caller is responsible for cascading the side-effect
 * (forgetFact on 'forgotten', etc.) via the existing CRUD path.
 *
 * Idempotent: if the row is already resolved, no second update
 * happens and we return `{ resolved: false }` so the route handler
 * can return a 409 if it wants strict semantics.
 */
export async function resolveReview(input: ResolveReviewInput): Promise<ResolveReviewResult> {
  const { workspaceId, reviewId, resolvedByUserId, resolution, tx } = input;
  const now = new Date();
  // Single UPDATE … WHERE resolved_at IS NULL gives us atomic
  // idempotency: the second resolver sees row_count=0 and we return
  // resolved:false.
  const updated = await tx
    .update(schema.mnemoReviewQueue)
    .set({
      resolvedAt: now,
      resolvedBy: resolvedByUserId,
      resolution,
    })
    .where(
      and(
        eq(schema.mnemoReviewQueue.id, reviewId),
        eq(schema.mnemoReviewQueue.workspaceId, workspaceId),
        isNull(schema.mnemoReviewQueue.resolvedAt)
      )
    )
    .returning({
      id: schema.mnemoReviewQueue.id,
      factId: schema.mnemoReviewQueue.factId,
    });
  const row = updated[0];
  if (row) return { resolved: true, factId: row.factId };
  // Row exists but is already resolved? OR doesn't exist? Disambiguate
  // for the caller.
  const lookup = await tx
    .select({ factId: schema.mnemoReviewQueue.factId })
    .from(schema.mnemoReviewQueue)
    .where(
      and(
        eq(schema.mnemoReviewQueue.id, reviewId),
        eq(schema.mnemoReviewQueue.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return { resolved: false, factId: lookup[0]?.factId ?? null };
}

export interface SweepCandidate {
  factId: string;
  confidence: number;
}

/**
 * Find facts that should be enqueued for low-confidence review:
 *   • confidence < 0.5
 *   • NOT pinned
 *   • status = 'active'
 *   • no OPEN review row already pointing at this fact (any reason —
 *     a 'contradiction' row already in flight suppresses the cron's
 *     'low_confidence' enqueue, same dedup as enqueueReview).
 *
 * Capped at `limit` candidates so the cron tick stays bounded. The
 * next tick picks up the long tail.
 */
export interface FindLowConfidenceCandidatesInput {
  workspaceId: string;
  /** Default 0.5. */
  confidenceThreshold?: number;
  /** Default 50. */
  limit?: number;
  tx: Tx;
}

export async function findLowConfidenceCandidates(
  input: FindLowConfidenceCandidatesInput
): Promise<SweepCandidate[]> {
  const { workspaceId, confidenceThreshold = 0.5, limit = 50, tx } = input;
  const rows = (await tx.execute(sql`
    SELECT f.id AS fact_id, f.confidence
    FROM mnemo_fact f
    WHERE f.workspace_id = ${workspaceId}
      AND f.status = 'active'
      AND f.confidence < ${confidenceThreshold}
      AND f.pinned = false
      AND NOT EXISTS (
        SELECT 1
        FROM mnemo_review_queue q
        WHERE q.workspace_id = f.workspace_id
          AND q.fact_id = f.id
          AND q.resolved_at IS NULL
      )
    ORDER BY f.confidence ASC, f.created_at ASC
    LIMIT ${limit}
  `)) as unknown as Array<{ fact_id: string; confidence: number }>;
  return rows.map((r) => ({
    factId: r.fact_id,
    confidence: Number(r.confidence),
  }));
}
