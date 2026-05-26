// packages/mnemosyne/src/entity/store.ts
//
// Mnemosyne v1.6 — CRUD over `mnemo_entity` (migration 0039).
//
// The 4th cognitive primitive alongside fact / decision / episode. An
// entity is a canonical "thing" (person / organization / project /
// concept / place / other) that facts reference via
// `mnemo_fact.entity_id`. The extraction pipeline calls `findOrCreate`
// per turn to dedupe mentions to a stable id, and the inspector reads
// + edits via the API routes in `apps/web/app/api/mnemo/entities/`.
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
 * The 6 entity kinds enforced by the SQL CHECK constraint on
 * `mnemo_entity.kind`. Intentionally small — broader taxonomies
 * (employee / vendor / customer / …) belong on the host side, not in
 * the cognitive primitive.
 */
export type EntityKind = "person" | "organization" | "project" | "concept" | "place" | "other";

export interface MnemoEntity {
  id: string;
  workspaceId: string;
  name: string;
  kind: EntityKind;
  aliases: string[];
  /** Self-reference for merge. NULL = this row is canonical. */
  canonicalId: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  mentionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEntityInput {
  workspaceId: string;
  name: string;
  kind: EntityKind;
  aliases?: string[];
  canonicalId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  tx: Tx;
}

export interface UpdateEntityInput {
  workspaceId: string;
  id: string;
  /** New canonical display name. */
  name?: string;
  /** New kind classification. CHECK-constraint enforced. */
  kind?: EntityKind;
  /** Full replacement of the aliases array. Caller is responsible for
   *  deduping. To append a single alias, pass `[...current, newOne]`. */
  aliases?: string[];
  /** Set to non-null to mark this row as merged into another canonical
   *  row. Set to null to mark as canonical itself. */
  canonicalId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  tx: Tx;
}

/**
 * Map a raw row (camelCase from drizzle's returning() OR snake_case
 * from a hand-rolled `tx.execute`) to the public MnemoEntity shape.
 * Defensive on Date|string for timestamp fields because postgres-js
 * has been seen to return either depending on driver version.
 */
function rowToEntity(
  r: Record<string, unknown> & {
    id: string;
    workspace_id?: string;
    workspaceId?: string;
    name: string;
    kind: EntityKind;
    aliases: string[] | null;
    canonical_id?: string | null;
    canonicalId?: string | null;
    description: string | null;
    metadata: Record<string, unknown> | null;
    first_seen_at?: Date | string;
    firstSeenAt?: Date | string;
    last_seen_at?: Date | string;
    lastSeenAt?: Date | string;
    mention_count?: number;
    mentionCount?: number;
    created_at?: Date | string;
    createdAt?: Date | string;
    updated_at?: Date | string;
    updatedAt?: Date | string;
  }
): MnemoEntity {
  const firstSeen = r.first_seen_at ?? r.firstSeenAt!;
  const lastSeen = r.last_seen_at ?? r.lastSeenAt!;
  const created = r.created_at ?? r.createdAt!;
  const updated = r.updated_at ?? r.updatedAt!;
  return {
    id: r.id,
    workspaceId: (r.workspace_id ?? r.workspaceId)!,
    name: r.name,
    kind: r.kind,
    aliases: r.aliases ?? [],
    canonicalId: (r.canonical_id ?? r.canonicalId ?? null) as string | null,
    description: r.description,
    metadata: r.metadata ?? {},
    firstSeenAt: firstSeen instanceof Date ? firstSeen : new Date(firstSeen),
    lastSeenAt: lastSeen instanceof Date ? lastSeen : new Date(lastSeen),
    mentionCount: Number(r.mention_count ?? r.mentionCount ?? 1),
    createdAt: created instanceof Date ? created : new Date(created),
    updatedAt: updated instanceof Date ? updated : new Date(updated),
  };
}

/**
 * Insert an entity row. Caller already holds the workspace-scoped tx
 * (RLS gate). Returns the row with its server-assigned timestamps.
 *
 * Dedup against the (workspace_id, name, kind) unique constraint is
 * intentionally NOT swallowed here — callers that want
 * upsert-on-conflict semantics should use `findOrCreate` instead,
 * which guarantees idempotence across concurrent extracts.
 */
export async function createEntity(input: CreateEntityInput): Promise<MnemoEntity> {
  const id = `ment_${createId()}`;
  const rows = await input.tx
    .insert(schema.mnemoEntity)
    .values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      kind: input.kind,
      aliases: input.aliases ?? [],
      canonicalId: input.canonicalId ?? null,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  const row = rows[0];
  if (!row) {
    // drizzle returning() never returns [] for a successful INSERT,
    // but a misbehaving driver shim might — fail loud rather than
    // returning an undefined-shaped value.
    throw new Error("createEntity: insert returned no rows");
  }
  return rowToEntity(row as never);
}

/**
 * Single-entity read by id. Filters on `workspace_id` too (defence in
 * depth — RLS already gates it). Returns null on miss.
 */
export async function getEntity(
  workspaceId: string,
  id: string,
  tx: Tx
): Promise<MnemoEntity | null> {
  const rows = await tx
    .select()
    .from(schema.mnemoEntity)
    .where(and(eq(schema.mnemoEntity.id, id), eq(schema.mnemoEntity.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  return row ? rowToEntity(row as never) : null;
}

/**
 * Mutate a subset of the editable columns on an entity row. The
 * `updatedAt` column is bumped automatically on every successful
 * update. Returns null when the row does not exist (or RLS hides it).
 *
 * No-op patches (every optional field undefined) return the current
 * row unchanged — we still issue the UPDATE so the caller can rely on
 * `updatedAt` reflecting the call. If you want to skip the write,
 * branch at the caller.
 */
export async function updateEntity(input: UpdateEntityInput): Promise<MnemoEntity | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.kind !== undefined) set.kind = input.kind;
  if (input.aliases !== undefined) set.aliases = input.aliases;
  if (input.canonicalId !== undefined) set.canonicalId = input.canonicalId;
  if (input.description !== undefined) set.description = input.description;
  if (input.metadata !== undefined) set.metadata = input.metadata;

  const rows = await input.tx
    .update(schema.mnemoEntity)
    .set(set)
    .where(
      and(
        eq(schema.mnemoEntity.id, input.id),
        eq(schema.mnemoEntity.workspaceId, input.workspaceId)
      )
    )
    .returning();
  const row = rows[0];
  return row ? rowToEntity(row as never) : null;
}

/**
 * Look up an entity by alias OR canonical name. Case-insensitive on
 * both sides — the alias array is searched with a lower() comparison
 * and the canonical name uses ILIKE. Returns the FIRST match (the GIN
 * index on aliases doesn't guarantee deterministic order across
 * matches; the extraction pipeline only cares about presence).
 */
export async function findByAlias(
  workspaceId: string,
  alias: string,
  tx: Tx
): Promise<MnemoEntity | null> {
  const needle = alias.trim();
  if (needle.length === 0) return null;

  // We OR three predicates:
  //   1. exact name match (most common — the LLM extracted the
  //      canonical form)
  //   2. case-insensitive name match (covers "lucas" → "Lucas")
  //   3. case-insensitive alias array membership (covers "@lucas" →
  //      "Lucas Mailland")
  // The GIN alias index serves (3) via the `@>` operator on a
  // lower()-mapped probe. We materialise the lowered probe once and
  // compare against `lower(unnest(aliases))` so the index can be used.
  const lowered = needle.toLowerCase();
  const rows = (await tx.execute(sql`
    SELECT
      id, workspace_id, name, kind, aliases, canonical_id, description,
      metadata, first_seen_at, last_seen_at, mention_count, created_at,
      updated_at
    FROM mnemo_entity
    WHERE workspace_id = ${workspaceId}
      AND (
        name = ${needle}
        OR lower(name) = ${lowered}
        OR EXISTS (
          SELECT 1 FROM unnest(aliases) AS a
          WHERE lower(a) = ${lowered}
        )
      )
    LIMIT 1
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

  const row = rows[0];
  return row ? rowToEntity(row as never) : null;
}

export interface FindOrCreateInput {
  workspaceId: string;
  name: string;
  kind: EntityKind;
  aliases?: string[];
  tx: Tx;
}

/**
 * Idempotent: returns the existing entity for (workspace_id, name,
 * kind) if one exists, otherwise inserts a new row. On the existing-
 * row path, the call bumps `last_seen_at` and `mention_count` so the
 * inspector's "important entities" sort key reflects recency +
 * frequency without a separate cron.
 *
 * Concurrent calls for the same (workspace, name, kind) are race-safe
 * via the UNIQUE constraint: the loser of the race catches the unique
 * violation and re-reads the winner's row. We use Postgres ON
 * CONFLICT … DO UPDATE to collapse the read/insert/read into a single
 * statement.
 *
 * Aliases passed at find-time are MERGED (not replaced) into the
 * existing row — so a second extract that surfaces a new spelling
 * widens the alias coverage without overwriting prior aliases.
 */
export async function findOrCreate(input: FindOrCreateInput): Promise<MnemoEntity> {
  const id = `ment_${createId()}`;
  const aliases = input.aliases ?? [];

  // ON CONFLICT … DO UPDATE bumps last_seen_at + mention_count and
  // merges any new aliases into the existing array. We use
  // `excluded.aliases || (existing.aliases - excluded.aliases)`
  // semantics via array deduplication: the result holds every alias
  // from either side exactly once.
  //
  // The `RETURNING` shape mirrors a regular SELECT so we can pipe
  // straight through rowToEntity.
  const rows = (await input.tx.execute(sql`
    INSERT INTO mnemo_entity (
      id, workspace_id, name, kind, aliases, metadata, mention_count
    ) VALUES (
      ${id},
      ${input.workspaceId},
      ${input.name},
      ${input.kind},
      ${sql.param(aliases)}::text[],
      '{}'::jsonb,
      1
    )
    ON CONFLICT (workspace_id, name, kind) DO UPDATE
      SET
        -- Merge aliases: union of existing + new, deduplicated.
        aliases = (
          SELECT ARRAY(
            SELECT DISTINCT unnest(mnemo_entity.aliases || EXCLUDED.aliases)
          )
        ),
        last_seen_at = now(),
        mention_count = mnemo_entity.mention_count + 1,
        updated_at = now()
    RETURNING
      id, workspace_id, name, kind, aliases, canonical_id, description,
      metadata, first_seen_at, last_seen_at, mention_count, created_at,
      updated_at
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

  const row = rows[0];
  if (!row) {
    // Defensive — RETURNING on a successful INSERT … ON CONFLICT DO
    // UPDATE always returns one row.
    throw new Error("findOrCreate: insert returned no rows");
  }
  return rowToEntity(row as never);
}
