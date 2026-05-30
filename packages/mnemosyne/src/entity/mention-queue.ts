// packages/mnemosyne/src/entity/mention-queue.ts
//
// v1.1 #22 — Unresolved-mention queue.
//
// CRM-style precision layer for entity mentions the extraction pipeline
// could not confidently resolve to a known `mnemo_entity` row. When the
// extractor finds a mention but lacks confidence (or the entity doesn't
// exist yet), it pushes a row here instead of (or alongside) creating a
// new entity. A human reviewer or background cron can later:
//
//   • Resolve → link to an existing entity via `resolveUnresolvedMention`.
//   • Dismiss → mark as noise / irrelevant via `dismissUnresolvedMention`.
//   • Forget  → stale rows aged past 30 days are swept by the janitor.
//
// Deduplication: if a pending mention for the same (workspace, rawName)
// already exists, `queueUnresolvedMention` increments `mention_count`
// instead of inserting a new row (ON CONFLICT DO UPDATE). This collapses
// multiple extractor passes that surface the same ambiguous name into one
// queue item, keeping the reviewer's inbox manageable.
//
// §0.1: package-clean — no server-only, no path aliases to the host app.

import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";

// ── Types ─────────────────────────────────────────────────────────────────────

export type UnresolvedMentionStatus = "pending" | "resolved" | "dismissed";

export interface MnemoUnresolvedMention {
  id: string;
  workspaceId: string;
  /** Raw entity mention string seen by the extractor. */
  rawName: string;
  /** Surrounding text for disambiguation. */
  context: string | null;
  /** Fact the mention came from (soft reference). */
  sourceFactId: string | null;
  /** Extractor certainty [0,1] that rawName is a genuine named entity. */
  confidence: number;
  /** Best-guess entity match from the extractor (soft reference). */
  suggestedEntityId: string | null;
  /** Times this rawName has been encountered since last pending mention. */
  mentionCount: number;
  status: UnresolvedMentionStatus;
  /** Set when status = 'resolved'. */
  resolvedEntityId: string | null;
  resolvedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueUnresolvedMentionInput {
  workspaceId: string;
  /** The raw entity mention text. */
  rawName: string;
  /** Surrounding text for context (up to ~500 chars is useful). */
  context?: string;
  /** ID of the `mnemo_fact` this mention was extracted from. */
  sourceFactId?: string;
  /** Extractor confidence [0,1] that rawName is a genuine entity. */
  confidence?: number;
  /** The extractor's best-guess entity match for the reviewers's reference. */
  suggestedEntityId?: string;
  /** Extractor-specific data (model, prompt version, etc.). */
  metadata?: Record<string, unknown>;
  tx: Tx;
}

export interface ResolveUnresolvedMentionInput {
  workspaceId: string;
  id: string;
  /** The `mnemo_entity.id` this mention resolves to. */
  entityId: string;
  tx: Tx;
}

export interface DismissUnresolvedMentionInput {
  workspaceId: string;
  id: string;
  tx: Tx;
}

export interface ListUnresolvedMentionsInput {
  workspaceId: string;
  /** Filter by status. Default: 'pending'. */
  status?: UnresolvedMentionStatus;
  /** Max rows to return. Default 50, bounded at [1, 200]. */
  limit?: number;
  /**
   * Cursor-based pagination: return mentions whose `created_at` is
   * strictly before this ISO timestamp. Combine with `limit` for pages.
   */
  before?: Date;
  tx: Tx;
}

export interface GetUnresolvedMentionInput {
  workspaceId: string;
  id: string;
  tx: Tx;
}

// ── Row mapper ────────────────────────────────────────────────────────────────

type MentionRow = typeof schema.mnemoUnresolvedMention.$inferSelect;

function rowToMention(r: MentionRow): MnemoUnresolvedMention {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    rawName: r.rawName,
    context: r.context ?? null,
    sourceFactId: r.sourceFactId ?? null,
    confidence: Number(r.confidence),
    suggestedEntityId: r.suggestedEntityId ?? null,
    mentionCount: Number(r.mentionCount),
    status: r.status as UnresolvedMentionStatus,
    resolvedEntityId: r.resolvedEntityId ?? null,
    resolvedAt: r.resolvedAt ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Queue an unresolved entity mention or, if a pending mention for the
 * same (workspaceId, rawName) already exists, increment its
 * `mention_count` and update context / confidence / suggestedEntityId if
 * the new values are more informative (higher confidence).
 *
 * Returns the upserted row — callers can check `mentionCount > 1` to
 * know whether this was a dedup merge rather than a fresh insertion.
 */
export async function queueUnresolvedMention(
  input: QueueUnresolvedMentionInput
): Promise<MnemoUnresolvedMention> {
  const {
    workspaceId,
    rawName,
    context,
    sourceFactId,
    confidence = 0.0,
    suggestedEntityId,
    metadata = {},
    tx,
  } = input;

  const id = createId();
  const now = new Date();

  // ON CONFLICT (workspace_id, raw_name) WHERE status = 'pending':
  //   • Increment mention_count.
  //   • Overwrite context + suggestedEntityId + confidence only when
  //     the new confidence is strictly higher (keep the best signal).
  //   • sourceFactId is left unchanged (first-wins — the original context
  //     is usually most useful for disambiguation).
  const rows = await tx.execute(sql`
    INSERT INTO mnemo_unresolved_mention
      (id, workspace_id, raw_name, context, source_fact_id, confidence,
       suggested_entity_id, mention_count, status, metadata, created_at, updated_at)
    VALUES
      (${id}, ${workspaceId}, ${rawName}, ${context ?? null}, ${sourceFactId ?? null},
       ${confidence}, ${suggestedEntityId ?? null}, 1, 'pending',
       ${JSON.stringify(metadata)}::jsonb, ${now}, ${now})
    ON CONFLICT (workspace_id, raw_name)
    WHERE status = 'pending'
    DO UPDATE SET
      mention_count       = mnemo_unresolved_mention.mention_count + 1,
      updated_at          = ${now},
      -- Replace context and suggested entity only if the new confidence
      -- is strictly higher — keeps the most informative signal.
      context             = CASE
        WHEN ${confidence} > mnemo_unresolved_mention.confidence
        THEN COALESCE(${context ?? null}, mnemo_unresolved_mention.context)
        ELSE mnemo_unresolved_mention.context
      END,
      suggested_entity_id = CASE
        WHEN ${confidence} > mnemo_unresolved_mention.confidence
        THEN COALESCE(${suggestedEntityId ?? null}, mnemo_unresolved_mention.suggested_entity_id)
        ELSE mnemo_unresolved_mention.suggested_entity_id
      END,
      confidence          = GREATEST(mnemo_unresolved_mention.confidence, ${confidence})
    RETURNING *
  `);

  const row = (rows as unknown as MentionRow[])[0];
  if (!row) throw new Error(`[mention-queue] upsert returned no row for rawName="${rawName}"`);
  return rowToMention(row);
}

/**
 * Mark an unresolved mention as resolved and link it to an entity.
 * Throws if the mention is not in `pending` status or does not belong
 * to `workspaceId`.
 */
export async function resolveUnresolvedMention(
  input: ResolveUnresolvedMentionInput
): Promise<MnemoUnresolvedMention> {
  const { workspaceId, id, entityId, tx } = input;
  const now = new Date();

  const rows = await tx.execute(sql`
    UPDATE mnemo_unresolved_mention
    SET
      status             = 'resolved',
      resolved_entity_id = ${entityId},
      resolved_at        = ${now},
      updated_at         = ${now}
    WHERE workspace_id = ${workspaceId}
      AND id           = ${id}
      AND status       = 'pending'
    RETURNING *
  `);

  const row = (rows as unknown as MentionRow[])[0];
  if (!row) {
    throw new Error(
      `[mention-queue] mention id="${id}" not found, not pending, or not in workspace`
    );
  }
  return rowToMention(row);
}

/**
 * Mark an unresolved mention as dismissed (noise / irrelevant). After
 * dismissal a fresh occurrence of the same rawName will open a new
 * pending mention (the UNIQUE partial index only covers pending rows).
 */
export async function dismissUnresolvedMention(
  input: DismissUnresolvedMentionInput
): Promise<MnemoUnresolvedMention> {
  const { workspaceId, id, tx } = input;
  const now = new Date();

  const rows = await tx.execute(sql`
    UPDATE mnemo_unresolved_mention
    SET
      status     = 'dismissed',
      resolved_at = ${now},
      updated_at  = ${now}
    WHERE workspace_id = ${workspaceId}
      AND id           = ${id}
      AND status       = 'pending'
    RETURNING *
  `);

  const row = (rows as unknown as MentionRow[])[0];
  if (!row) {
    throw new Error(
      `[mention-queue] mention id="${id}" not found, not pending, or not in workspace`
    );
  }
  return rowToMention(row);
}

/**
 * List unresolved mentions for a workspace, newest first.
 */
export async function listUnresolvedMentions(
  input: ListUnresolvedMentionsInput
): Promise<MnemoUnresolvedMention[]> {
  const { workspaceId, status = "pending", limit = 50, before, tx } = input;

  const safeLim = Math.min(Math.max(1, limit), 200);

  const rows = await tx.execute(sql`
    SELECT * FROM mnemo_unresolved_mention
    WHERE workspace_id = ${workspaceId}
      AND status       = ${status}
      ${before ? sql`AND created_at < ${before}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${safeLim}
  `);

  return (rows as unknown as MentionRow[]).map(rowToMention);
}

/**
 * Fetch a single unresolved mention by id. Returns null when not found
 * or when the mention does not belong to the given workspace.
 */
export async function getUnresolvedMention(
  input: GetUnresolvedMentionInput
): Promise<MnemoUnresolvedMention | null> {
  const { workspaceId, id, tx } = input;

  const rows = await tx.execute(sql`
    SELECT * FROM mnemo_unresolved_mention
    WHERE workspace_id = ${workspaceId}
      AND id           = ${id}
    LIMIT 1
  `);

  const row = (rows as unknown as MentionRow[])[0];
  return row ? rowToMention(row) : null;
}
