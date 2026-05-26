// packages/mnemosyne/src/episode/store.ts
//
// Mnemosyne v1.4 — CRUD over `mnemo_episode` (migration 0034).
//
// All helpers require an active `Tx` so RLS+FORCE Pattern A applies:
// callers wrap in `withMnemoTx(workspaceId, …)` which sets the
// `app.workspace_id` GUC and downgrades the tx to `app_user`.
//
// §0.1: package-clean — no `server-only`, no host imports, no path
// aliases that reach into apps/web.
import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";

/**
 * The four memory types from v1.4 — mirrors the DB CHECK constraint on
 * `mnemo_fact.memory_type`. Exported here too so consumers can `import
 * { MemoryType } from "@orchester/mnemosyne/episode"` without grabbing
 * the entire fact primitive.
 */
export type MemoryType = "semantic" | "episodic" | "procedural" | "working";

export interface MnemoEpisode {
  id: string;
  workspaceId: string;
  title: string;
  narrative: string;
  occurredAt: Date;
  durationMinutes: number | null;
  participants: string[];
  topics: string[];
  linkedFactIds: string[];
  sourceConversationId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEpisodeInput {
  workspaceId: string;
  title: string;
  narrative: string;
  occurredAt: Date;
  durationMinutes?: number;
  participants?: string[];
  topics?: string[];
  linkedFactIds?: string[];
  sourceConversationId?: string;
  metadata?: Record<string, unknown>;
  tx: Tx;
}

/**
 * Map a raw row (camelCase from drizzle's returning() OR snake_case
 * from a hand-rolled tx.execute) to the public MnemoEpisode shape.
 * Defensive on both Date and string `occurred_at` because postgres-js
 * has been seen to return either depending on driver version.
 */
function rowToEpisode(
  r: Record<string, unknown> & {
    id: string;
    workspace_id?: string;
    workspaceId?: string;
    title: string;
    narrative: string;
    occurred_at?: Date | string;
    occurredAt?: Date | string;
    duration_minutes?: number | null;
    durationMinutes?: number | null;
    participants: string[] | null;
    topics: string[] | null;
    linked_fact_ids?: string[] | null;
    linkedFactIds?: string[] | null;
    source_conversation_id?: string | null;
    sourceConversationId?: string | null;
    metadata: Record<string, unknown> | null;
    created_at?: Date | string;
    createdAt?: Date | string;
    updated_at?: Date | string;
    updatedAt?: Date | string;
  }
): MnemoEpisode {
  const occurred = r.occurred_at ?? r.occurredAt!;
  const created = r.created_at ?? r.createdAt!;
  const updated = r.updated_at ?? r.updatedAt!;
  return {
    id: r.id,
    workspaceId: (r.workspace_id ?? r.workspaceId)!,
    title: r.title,
    narrative: r.narrative,
    occurredAt: occurred instanceof Date ? occurred : new Date(occurred),
    durationMinutes: (r.duration_minutes ?? r.durationMinutes ?? null) as number | null,
    participants: r.participants ?? [],
    topics: r.topics ?? [],
    linkedFactIds: r.linked_fact_ids ?? r.linkedFactIds ?? [],
    sourceConversationId: (r.source_conversation_id ?? r.sourceConversationId ?? null) as
      | string
      | null,
    metadata: r.metadata ?? {},
    createdAt: created instanceof Date ? created : new Date(created),
    updatedAt: updated instanceof Date ? updated : new Date(updated),
  };
}

/**
 * Insert an episode row. Caller already holds the workspace-scoped tx
 * (RLS gate). Returns the row with its server-assigned timestamps.
 *
 * `durationMinutes` is optional — instantaneous events (a single
 * decision logged in passing) omit it. Arrays default to empty rather
 * than NULL to match the SQL DEFAULT '{}' and keep the consumer side
 * branch-free.
 */
export async function createEpisode(input: CreateEpisodeInput): Promise<MnemoEpisode> {
  const id = `mepi_${createId()}`;
  const rows = await input.tx
    .insert(schema.mnemoEpisode)
    .values({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      narrative: input.narrative,
      occurredAt: input.occurredAt,
      // drizzle's `integer().nullable()` defaults to NULL when the
      // key is absent; we still explicitly pass `null` so the
      // TypeScript shape stays narrow.
      durationMinutes: input.durationMinutes ?? null,
      participants: input.participants ?? [],
      topics: input.topics ?? [],
      linkedFactIds: input.linkedFactIds ?? [],
      sourceConversationId: input.sourceConversationId ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  const row = rows[0];
  if (!row) {
    // drizzle returning() never returns [] for a successful INSERT,
    // but a misbehaving driver shim might — fail loud rather than
    // returning an undefined-shaped value.
    throw new Error("createEpisode: insert returned no rows");
  }
  return rowToEpisode(row as never);
}

/**
 * Single-episode read by id. Filters on `workspace_id` too (defence
 * in depth — RLS already gates it but the extra predicate hits the
 * (workspace_id, occurred_at) index instead of a PK lookup that would
 * then re-check RLS). Returns null on miss.
 */
export async function getEpisode(
  workspaceId: string,
  id: string,
  tx: Tx
): Promise<MnemoEpisode | null> {
  const rows = await tx
    .select()
    .from(schema.mnemoEpisode)
    .where(and(eq(schema.mnemoEpisode.id, id), eq(schema.mnemoEpisode.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  return row ? rowToEpisode(row as never) : null;
}

export interface LinkFactToEpisodeInput {
  workspaceId: string;
  episodeId: string;
  factId: string;
  tx: Tx;
}

/**
 * Append a fact id to `linked_fact_ids` on the episode, idempotently.
 * Postgres `array_append` would double up on repeated calls, so we
 * use `array_remove(... , $factId) || ARRAY[$factId]` which guarantees
 * the result holds exactly one occurrence regardless of starting state.
 *
 * The opposite direction (`mnemo_fact.metadata.episode_id`) is owned by
 * the extraction pipeline — we don't touch the fact row here to avoid
 * churning embedding / FTS columns. Callers who need both directions
 * link can update metadata via the fact CRUD path.
 */
export async function linkFactToEpisode(input: LinkFactToEpisodeInput): Promise<void> {
  const { workspaceId, episodeId, factId, tx } = input;
  await tx.execute(sql`
    UPDATE mnemo_episode
    SET linked_fact_ids = array_remove(linked_fact_ids, ${factId}) || ARRAY[${factId}]::text[],
        updated_at = now()
    WHERE id = ${episodeId} AND workspace_id = ${workspaceId}
  `);
}
