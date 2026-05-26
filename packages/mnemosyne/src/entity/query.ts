// packages/mnemosyne/src/entity/query.ts
//
// Mnemosyne v1.6 — read-side helpers over `mnemo_entity` (migration
// 0039) and the `mnemo_fact.entity_id` link.
//
// `listEntities` powers the inspector's entity browser (filter by
// kind, search by name/alias). `listFactsForEntity` returns the
// facts the extraction pipeline linked to a given entity — the
// reverse of the `mnemo_fact.entity_id → mnemo_entity.id` foreign
// pointer.
//
// §0.1: package-clean — no host imports, no `server-only`.
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";
import type { EntityKind, MnemoEntity } from "./store";
import type { MnemoFact } from "../primitives/fact";

export interface ListEntitiesInput {
  workspaceId: string;
  /** Filter by kind. Omit for all kinds. */
  kind?: EntityKind;
  /** Free-text search across `name` AND `aliases`. Case-insensitive.
   *  A trim+empty-check filters out whitespace-only inputs so the
   *  inspector doesn't paginate an unfiltered scan when the user
   *  clears the search box. */
  q?: string;
  /** Hard cap on returned rows. Default 50, max 200 (matches the
   *  facts route's pagination ceiling). */
  limit?: number;
  tx: Tx;
}

/**
 * Return entities matching the filters. Newest-first by `last_seen_at`
 * — the inspector wants "most recently mentioned at top" which double
 * as "most likely interesting right now". Falls back to `created_at`
 * + `id` as deterministic tiebreakers so a paginated UI doesn't
 * shuffle rows on each refresh.
 */
export async function listEntities(input: ListEntitiesInput): Promise<MnemoEntity[]> {
  const { workspaceId, kind, q, tx } = input;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const needle = q?.trim() ?? "";
  const lowered = needle.toLowerCase();
  const likePattern = `%${lowered}%`;

  // Hand-rolled SQL because:
  //   • the alias predicate needs an EXISTS … unnest pattern that
  //     drizzle's where-builder doesn't model cleanly
  //   • the optional q + kind filters are ergonomic as conditional
  //     `sql` fragments instead of where-chains
  //
  // The composite (workspace_id, kind) index covers the kind filter;
  // the bare workspace_id index covers the unfiltered case. q is a
  // post-filter (no FTS column on the entity table at v1.6 — adding
  // one would force a tsvector migration that we'll do later if usage
  // warrants).
  const rows = (await tx.execute(sql`
    SELECT
      id, workspace_id, name, kind, aliases, canonical_id, description,
      metadata, first_seen_at, last_seen_at, mention_count, created_at,
      updated_at
    FROM mnemo_entity
    WHERE workspace_id = ${workspaceId}
      ${kind ? sql`AND kind = ${kind}` : sql``}
      ${
        needle.length > 0
          ? sql`AND (
              lower(name) LIKE ${likePattern}
              OR EXISTS (
                SELECT 1 FROM unnest(aliases) AS a
                WHERE lower(a) LIKE ${likePattern}
              )
            )`
          : sql``
      }
    ORDER BY last_seen_at DESC, created_at DESC, id DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    workspace_id: string;
    name: string;
    kind: EntityKind;
    aliases: string[] | null;
    canonical_id: string | null;
    description: string | null;
    metadata: Record<string, unknown> | null;
    first_seen_at: Date | string;
    last_seen_at: Date | string;
    mention_count: number;
    created_at: Date | string;
    updated_at: Date | string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    kind: r.kind,
    aliases: r.aliases ?? [],
    canonicalId: r.canonical_id,
    description: r.description,
    metadata: r.metadata ?? {},
    firstSeenAt: r.first_seen_at instanceof Date ? r.first_seen_at : new Date(r.first_seen_at),
    lastSeenAt: r.last_seen_at instanceof Date ? r.last_seen_at : new Date(r.last_seen_at),
    mentionCount: Number(r.mention_count ?? 1),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  }));
}

export interface ListFactsForEntityInput {
  workspaceId: string;
  entityId: string;
  /** Hard cap. Default 100, max 500 — facts-per-entity dominates the
   *  total query bytes so we let the inspector batch larger windows
   *  here than on the entity list. */
  limit?: number;
  tx: Tx;
}

/**
 * Return facts the extraction pipeline linked to this entity via
 * `mnemo_fact.entity_id`. Active rows only — forgotten/merged facts
 * stay hidden from the inspector's entity-detail view; the inspector's
 * "show forgotten" toggle lives on the facts route, not here.
 *
 * The partial index `idx_mnemo_fact_entity` (migration 0039) covers
 * the (workspace_id, entity_id) predicate; the status filter is a
 * post-filter recheck.
 */
export async function listFactsForEntity(input: ListFactsForEntityInput): Promise<MnemoFact[]> {
  const { workspaceId, entityId, tx } = input;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

  const rows = (await tx.execute(sql`
    SELECT
      id, workspace_id, agent_id, scope, scope_ref, kind, subject,
      statement, confidence, pinned, relevance, hit_count,
      last_recalled_at, source_message_ids, attributed_to,
      linked_memory_ids, embedding, embedding_model, embedding_version,
      metadata, status, merged_into_id, valid_from, valid_to,
      created_at, updated_at, memory_type, actor_id, attribution,
      entity_id
    FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
      AND entity_id = ${entityId}
      AND status = 'active'
    ORDER BY updated_at DESC, id DESC
    LIMIT ${limit}
  `)) as unknown as MnemoFact[];

  // The driver returns snake_case for fields not in the drizzle
  // mapping table; we trust the consumer (route handler) to surface
  // whatever shape it needs. The MnemoFact type is permissive on
  // optional fields (actorId, attribution, memoryType) so a
  // snake_case row passes the type guard via the `as` cast.
  return rows;
}
