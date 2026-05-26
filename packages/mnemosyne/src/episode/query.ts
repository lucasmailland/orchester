// packages/mnemosyne/src/episode/query.ts
//
// Mnemosyne v1.4 — timeline queries over `mnemo_episode` (migration
// 0034). Read-side helpers only; CRUD lives in `./store.ts`.
//
// The primary read pattern is "give me everything in workspace W
// between dates [from, to], optionally filtered by topic, newest
// first". The composite index `idx_mnemo_episode_workspace_occurred`
// serves the date sort; the GIN index `idx_mnemo_episode_topics`
// serves the topic predicate.
//
// §0.1: package-clean — no host imports, no `server-only`.
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";
import type { MnemoEpisode } from "./store";

export interface ListEpisodesInput {
  workspaceId: string;
  /** Inclusive lower bound on `occurred_at`. Defaults to now() - 30d
   *  if unset — the timeline UI rarely cares about older slices
   *  unless explicitly requested. */
  from?: Date;
  /** Inclusive upper bound. Defaults to now(). */
  to?: Date;
  /** Single-topic filter via the GIN-indexed `topics` array. Multi-
   *  topic filtering is intentionally out of scope at v1.4 — the UI
   *  drives a chip-style single-select. */
  topic?: string;
  /** Hard cap on returned rows. Default 50, max 200 (matches the
   *  facts route's pagination ceiling). */
  limit?: number;
  tx: Tx;
}

/**
 * Return episodes in the date window, newest first. Date defaults
 * are computed *inside* the function so a long-lived caller (e.g.
 * the dashboard SSR cache) never sees a stale "now".
 */
export async function listEpisodes(input: ListEpisodesInput): Promise<MnemoEpisode[]> {
  const { workspaceId, topic, tx } = input;
  const now = new Date();
  const to = input.to ?? now;
  // Default 30-day window — large enough to cover a sprint review,
  // small enough that the index sees a tight range scan.
  const from = input.from ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  // Hand-rolled SQL because (a) we want the GIN topic predicate as
  // `${topic} = ANY(topics)` and (b) drizzle's WHERE composition is
  // less ergonomic for the optional-array-predicate pattern.
  //
  // Note: drizzle's `sql` tagged template binds Date objects via the
  // postgres-js driver which (on some versions of `postgres@3.x`)
  // rejects Date instances at the wire layer with `The "string"
  // argument must be of type string … Received an instance of Date`.
  // Cast to ISO strings + explicit `::timestamptz` so Postgres parses
  // them as timestamps regardless of the driver version in use.
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const rows = (await tx.execute(sql`
    SELECT
      id, workspace_id, title, narrative, occurred_at, duration_minutes,
      participants, topics, linked_fact_ids, source_conversation_id,
      metadata, created_at, updated_at
    FROM mnemo_episode
    WHERE workspace_id = ${workspaceId}
      AND occurred_at >= ${fromIso}::timestamptz
      AND occurred_at <= ${toIso}::timestamptz
      ${topic ? sql`AND ${topic} = ANY(topics)` : sql``}
    ORDER BY occurred_at DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    workspace_id: string;
    title: string;
    narrative: string;
    occurred_at: Date | string;
    duration_minutes: number | null;
    participants: string[] | null;
    topics: string[] | null;
    linked_fact_ids: string[] | null;
    source_conversation_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    narrative: r.narrative,
    occurredAt: r.occurred_at instanceof Date ? r.occurred_at : new Date(r.occurred_at),
    durationMinutes: r.duration_minutes,
    participants: r.participants ?? [],
    topics: r.topics ?? [],
    linkedFactIds: r.linked_fact_ids ?? [],
    sourceConversationId: r.source_conversation_id,
    metadata: r.metadata ?? {},
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  }));
}
