// packages/mnemosyne/src/summary/store.ts
//
// CRUD wrappers for `mnemo_summary` (Layer 1 distilled user profile,
// migration 0028). Every call MUST run inside a tx with
// `app.workspace_id` set — `withMnemoTx` handles that. RLS+FORCE
// Pattern A gates every read/write.
//
// §0.1: package-clean — no `server-only`, no host imports.
import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";

/** Internal row shape — mirrors the table 1:1, including timestamps. */
export interface MnemoSummaryRow {
  id: string;
  workspaceId: string;
  agentId: string;
  userId: string | null;
  summaryText: string;
  summaryStruct: Record<string, unknown>;
  sourceFactIds: string[];
  modelUsed: string | null;
  tokenCount: number | null;
  generatedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertSummaryInput {
  workspaceId: string;
  agentId: string;
  userId?: string | null;
  summaryText: string;
  summaryStruct: Record<string, unknown>;
  sourceFactIds: string[];
  modelUsed?: string | null;
  tokenCount?: number | null;
  /** TTL in ms before the row counts as expired. Default 24h. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Look up the cached summary for (workspace, agent, user). Returns null
 * when no row exists. `userId === null` means the workspace-level
 * (user-agnostic) summary.
 *
 * IMPORTANT: caller controls the transaction. `withMnemoTx` must have
 * already set `app.workspace_id` for RLS FORCE to admit the row.
 */
export async function getSummary(
  workspaceId: string,
  agentId: string,
  userId: string | null | undefined,
  tx: Tx
): Promise<MnemoSummaryRow | null> {
  const userFilter =
    userId === null || userId === undefined
      ? isNull(schema.mnemoSummary.userId)
      : eq(schema.mnemoSummary.userId, userId);

  const rows = await tx
    .select()
    .from(schema.mnemoSummary)
    .where(
      and(
        eq(schema.mnemoSummary.workspaceId, workspaceId),
        eq(schema.mnemoSummary.agentId, agentId),
        userFilter
      )
    )
    .limit(1);

  return (rows[0] as MnemoSummaryRow | undefined) ?? null;
}

/**
 * Upsert by the unique key (workspace, agent, user). The DB unique
 * index treats NULL userId as distinct from non-NULL — Postgres'
 * default NULLs-distinct semantics. This means there can be at most one
 * row per (workspace, agent) with userId NULL, and at most one per
 * (workspace, agent, specific user). Our existence check above mirrors
 * that distinction explicitly.
 *
 * On conflict we replace summary_text / summary_struct / source_fact_ids
 * / model_used / token_count / generated_at / expires_at and bump
 * updated_at via the trigger. The `id` and `created_at` of the original
 * row are preserved (we don't insert a fresh `id`).
 */
export async function upsertSummary(input: UpsertSummaryInput, tx: Tx): Promise<MnemoSummaryRow> {
  const userId = input.userId ?? null;
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Try update first (cheaper when a row exists). If no row was
  // updated, insert a fresh one. We avoid `ON CONFLICT DO UPDATE`
  // because the unique key partially involves a nullable column and
  // Postgres' NULL-distinct semantics make the conflict target subtle.
  const existing = await getSummary(input.workspaceId, input.agentId, userId, tx);
  if (existing) {
    const updated = await tx
      .update(schema.mnemoSummary)
      .set({
        summaryText: input.summaryText,
        summaryStruct: input.summaryStruct,
        sourceFactIds: input.sourceFactIds,
        modelUsed: input.modelUsed ?? null,
        tokenCount: input.tokenCount ?? null,
        generatedAt: now,
        expiresAt,
      })
      .where(eq(schema.mnemoSummary.id, existing.id))
      .returning();
    return updated[0] as MnemoSummaryRow;
  }

  const id = `msum_${createId()}`;
  const inserted = await tx
    .insert(schema.mnemoSummary)
    .values({
      id,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      userId,
      summaryText: input.summaryText,
      summaryStruct: input.summaryStruct,
      sourceFactIds: input.sourceFactIds,
      modelUsed: input.modelUsed ?? null,
      tokenCount: input.tokenCount ?? null,
      generatedAt: now,
      expiresAt,
    })
    .returning();
  return inserted[0] as MnemoSummaryRow;
}

/**
 * Force the cached summary to count as expired (sets expires_at = now).
 * Use this when a downstream event invalidates the cached profile (a
 * user pinned/forgot a fact, an admin edited the workspace, etc.).
 *
 * No-op when no row exists. When `userId` is omitted, only the
 * workspace-level row is invalidated; pass `userId: undefined` (or
 * null) to invalidate the workspace-level row, an explicit string to
 * invalidate the per-user row.
 */
export async function invalidateSummary(
  workspaceId: string,
  agentId: string,
  userId: string | null | undefined,
  tx: Tx
): Promise<void> {
  const userFilter =
    userId === null || userId === undefined
      ? isNull(schema.mnemoSummary.userId)
      : eq(schema.mnemoSummary.userId, userId);

  await tx
    .update(schema.mnemoSummary)
    .set({ expiresAt: sql`now()` })
    .where(
      and(
        eq(schema.mnemoSummary.workspaceId, workspaceId),
        eq(schema.mnemoSummary.agentId, agentId),
        userFilter
      )
    );
}
