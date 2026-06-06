// apps/web/lib/mnemo/entities.ts
//
// Dual-mode implementation of the workspace's entity browser surface.
// Same shape as `lib/mnemo/graph.ts`: pick HTTP vs in-process at
// runtime via `MNEMO_URL` / `MNEMO_API_KEY`. Service mode is the
// canonical Phase 2 path; library mode is the legacy fallback kept
// alive for dev environments without a docker-compose stack running.
//
// Three helpers cover the three read endpoints under /v1/entities:
//   - listWorkspaceEntities  → GET /api/mnemo/entities
//   - getWorkspaceEntity     → GET /api/mnemo/entities/[id]
//   - listEntityFacts        → GET /api/mnemo/entities/[id]/facts
//
// All three return a discriminated `{ mode, ... }` envelope so the
// caller can stamp the `X-Mnemo-Mode` response header for operator
// visibility (matches the graph route's pattern).
//
// Wire shape contract:
//   The helper returns the *wire* shape — Date fields collapsed to
//   ISO 8601 strings — regardless of mode. In library mode that
//   collapse happens in the helper; in service mode the SDK already
//   returns wire shape. This means consumers see a single canonical
//   shape no matter how the data arrived.

import "server-only";
import type {
  CreateEntityInput,
  EntityFactsResponse,
  EntityKind,
  EntityWithCount,
  ListEntitiesResponse,
  MemoryFact,
  MnemoEntity,
  UpdateEntityInput,
} from "@mnemosyne/client-ts";
import { getMnemoMode, type MnemoMode } from "@/lib/mnemo/client";

// Re-export so existing callers keep working while we centralise the
// mode logic in `@/lib/mnemo/client`. New code should import from
// there directly.
export { getMnemoMode };
export type { MnemoMode };

/**
 * Map a library-shape `MnemoEntity` (Date fields) onto the wire-shape
 * `MnemoEntity` (ISO strings). Defined inline rather than in a shared
 * util because the only callers are these 3 helpers — keeping the
 * Date↔string boundary visible in the helper file beats a one-line
 * import for trivial mapping code.
 */
function entityRowToWire(e: {
  id: string;
  workspaceId: string;
  name: string;
  kind: EntityKind;
  aliases: string[];
  canonicalId: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  mentionCount: number;
  createdAt: Date;
  updatedAt: Date;
}): MnemoEntity {
  return {
    id: e.id,
    workspaceId: e.workspaceId,
    name: e.name,
    kind: e.kind,
    aliases: e.aliases,
    canonicalId: e.canonicalId,
    description: e.description,
    metadata: e.metadata,
    firstSeenAt: e.firstSeenAt.toISOString(),
    lastSeenAt: e.lastSeenAt.toISOString(),
    mentionCount: e.mentionCount,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

/**
 * Map a library `MnemoFact` (Date fields, includes `embedding`) onto
 * the wire-shape `MemoryFact` (ISO strings, no embedding). The
 * `embedding` column is dropped from the wire — clients never need the
 * raw vector and shipping 1536 floats per fact would balloon payloads.
 */
function factRowToWire(f: {
  id: string;
  workspaceId: string;
  agentId: string | null;
  scope: "global" | "conversation" | "employee" | "team";
  scopeRef: string | null;
  kind: "preference" | "trait" | "event" | "relationship" | "skill" | "concern" | "other";
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  relevance: number;
  hitCount: number;
  lastRecalledAt: Date | null;
  sourceMessageIds: string[];
  attributedTo: "user" | "assistant" | "system" | null;
  linkedMemoryIds: string[];
  metadata: Record<string, unknown>;
  status: "active" | "merged" | "forgotten";
  mergedIntoId: string | null;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
  memoryType?: "semantic" | "episodic" | "procedural" | "working";
  actorId?: string | null;
}): MemoryFact {
  const wire: MemoryFact = {
    id: f.id,
    workspaceId: f.workspaceId,
    agentId: f.agentId,
    scope: f.scope,
    scopeRef: f.scopeRef,
    kind: f.kind,
    subject: f.subject,
    statement: f.statement,
    confidence: f.confidence,
    pinned: f.pinned,
    relevance: f.relevance,
    hitCount: f.hitCount,
    lastRecalledAt: f.lastRecalledAt ? f.lastRecalledAt.toISOString() : null,
    sourceMessageIds: f.sourceMessageIds,
    attributedTo: f.attributedTo,
    linkedMemoryIds: f.linkedMemoryIds,
    metadata: f.metadata,
    status: f.status,
    mergedIntoId: f.mergedIntoId,
    validFrom: f.validFrom.toISOString(),
    validTo: f.validTo ? f.validTo.toISOString() : null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
  if (f.memoryType !== undefined) wire.memoryType = f.memoryType;
  if (f.actorId !== undefined) wire.actorId = f.actorId;
  return wire;
}

/**
 * List entities in a workspace. Service mode delegates to
 * `client.listEntities`; library mode falls through to the in-process
 * `listEntities` helper under a workspace-scoped tx.
 */
export async function listWorkspaceEntities(
  workspaceId: string,
  opts: { kind?: EntityKind; q?: string; limit: number }
): Promise<{ mode: MnemoMode; data: ListEntitiesResponse }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    const data = await client.listEntities({
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.q ? { q: opts.q } : {}),
      limit: opts.limit,
    });
    return { mode, data };
  }

  const [{ listEntities, withMnemoTx }] = await Promise.all([import("@mnemosyne/core")]);
  const items = await withMnemoTx(workspaceId, (tx) =>
    listEntities({
      workspaceId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.q && opts.q.trim().length > 0 ? { q: opts.q } : {}),
      limit: opts.limit,
      tx,
    })
  );
  return {
    mode,
    data: { items: items.map(entityRowToWire) },
  };
}

/**
 * Fetch one entity + its active-fact count. Returns null in the data
 * field when the entity does not exist (callers map to 404).
 */
export async function getWorkspaceEntity(
  workspaceId: string,
  id: string
): Promise<{ mode: MnemoMode; data: EntityWithCount | null }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    // `getEntity` throws MnemosyneAPIError on 404; we translate that
    // into a null data field so the route handler can map uniformly to
    // a 404 response regardless of mode. Other errors (5xx, network)
    // bubble.
    try {
      const data = await client.getEntity(id);
      return { mode, data };
    } catch (e) {
      const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  // Library path mirrors the original orchester route's logic verbatim
  // — getEntity + a one-row COUNT(*) for the linked-fact chip — so the
  // diff against the original route is the trivial `mode === "service"
  // ? sdk : library`.
  const { getEntity, withMnemoTx } = await import("@mnemosyne/core");
  const { sql } = await import("drizzle-orm");
  const result = await withMnemoTx(workspaceId, async (tx) => {
    const entity = await getEntity(workspaceId, id, tx);
    if (!entity) return null;
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM mnemo_fact
      WHERE workspace_id = ${workspaceId}
        AND entity_id = ${id}
        AND status = 'active'
    `)) as unknown as Array<{ total: number }>;
    return {
      entity: entityRowToWire(entity),
      linkedFactCount: countRows[0]?.total ?? 0,
    };
  });
  return { mode, data: result };
}

/**
 * List the facts linked to an entity. Returns null in the data field
 * when the entity itself does not exist.
 */
export async function listWorkspaceEntityFacts(
  workspaceId: string,
  id: string,
  opts: { limit: number }
): Promise<{ mode: MnemoMode; data: EntityFactsResponse | null }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    try {
      const data = await client.listEntityFacts(id, { limit: opts.limit });
      return { mode, data };
    } catch (e) {
      const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  const { getEntity, listFactsForEntity, withMnemoTx } = await import("@mnemosyne/core");
  const result = await withMnemoTx(workspaceId, async (tx) => {
    const entity = await getEntity(workspaceId, id, tx);
    if (!entity) return null;
    const facts = await listFactsForEntity({
      workspaceId,
      entityId: id,
      limit: opts.limit,
      tx,
    });
    return {
      entity: entityRowToWire(entity),
      facts: facts.map(factRowToWire),
    };
  });
  return { mode, data: result };
}

/**
 * Manually create an entity. Service mode delegates to
 * `client.createEntity`; library mode falls through to the in-process
 * `createEntity` helper under a workspace-scoped tx. Either path
 * surfaces the `(workspace_id, name, kind)` unique-constraint
 * violation as a thrown error — the route handler maps it to 409.
 */
export async function createWorkspaceEntity(
  workspaceId: string,
  input: CreateEntityInput
): Promise<{ mode: MnemoMode; data: MnemoEntity }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    const data = await client.createEntity(input);
    return { mode, data };
  }

  const { createEntity, withMnemoTx } = await import("@mnemosyne/core");
  const created = await withMnemoTx(workspaceId, (tx) =>
    createEntity({
      workspaceId,
      name: input.name,
      kind: input.kind,
      aliases: input.aliases ?? [],
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      tx,
    })
  );
  return { mode, data: entityRowToWire(created) };
}

/**
 * Patch an entity. Returns `data:null` when the row does not exist
 * (route maps → 404). The canonicalId sanity check (must exist in
 * this workspace, must not equal id) is upstream in service mode;
 * in library mode the caller is responsible (the legacy route does
 * its own select-1 check before calling). We surface the same shape
 * either way — the route reads the legacy guard verbatim.
 */
export async function updateWorkspaceEntity(
  workspaceId: string,
  id: string,
  input: UpdateEntityInput
): Promise<{ mode: MnemoMode; data: MnemoEntity | null }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    const client = getMnemoClient();
    try {
      const data = await client.updateEntity(id, input);
      return { mode, data };
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  const { updateEntity, withMnemoTx } = await import("@mnemosyne/core");
  const updated = await withMnemoTx(workspaceId, (tx) =>
    updateEntity({
      workspaceId,
      id,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
      ...(input.canonicalId !== undefined ? { canonicalId: input.canonicalId } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      tx,
    })
  );
  return { mode, data: updated ? entityRowToWire(updated) : null };
}

/**
 * Sanity-check helper used by the PATCH route's canonicalId
 * validation. In service mode we don't expose a dedicated endpoint
 * for this (the upstream PATCH handler does the check itself), so we
 * fall back to a `getEntity()` round-trip and inspect for 404. In
 * library mode it's a 1-row select, same as the legacy route.
 */
export async function workspaceEntityExists(workspaceId: string, id: string): Promise<boolean> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    const client = getMnemoClient();
    try {
      await client.getEntity(id);
      return true;
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) return false;
      throw e;
    }
  }

  const { withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { and, eq } = await import("drizzle-orm");
  return withMnemoTx(workspaceId, async (tx) => {
    const rows = await tx
      .select({ id: schema.mnemoEntity.id })
      .from(schema.mnemoEntity)
      .where(and(eq(schema.mnemoEntity.id, id), eq(schema.mnemoEntity.workspaceId, workspaceId)))
      .limit(1);
    return rows.length > 0;
  });
}
