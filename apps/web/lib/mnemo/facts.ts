// apps/web/lib/mnemo/facts.ts
//
// Dual-mode implementation of the orchester `/api/mnemo/facts*` route
// family. Picks HTTP (service mode) vs in-process (library mode) at
// runtime via `MNEMO_URL` + `MNEMO_API_KEY`.
//
// Surfaces:
//   - listWorkspaceFacts          ─ GET  /api/mnemo/facts
//   - getWorkspaceFact            ─ GET  /api/mnemo/facts/[id]
//   - patchWorkspaceFact          ─ PATCH /api/mnemo/facts/[id]
//   - pinWorkspaceFact            ─ POST /api/mnemo/facts/[id]/pin
//   - unpinWorkspaceFact          ─ POST /api/mnemo/facts/[id]/unpin
//   - forgetWorkspaceFact         ─ POST /api/mnemo/facts/[id]/forget
//   - restoreWorkspaceFact        ─ POST /api/mnemo/facts/[id]/restore
//   - getWorkspaceFactCitations   ─ GET  /api/mnemo/facts/[id]/citations
//                                   (hybrid: ids from upstream, message
//                                    JOIN host-side)

import "server-only";
import type { DbClient } from "@orchester/db";
import type { ListFactsResponse, PatchFactInput, RestoreFactResponse } from "@mnemosyne/client-ts";

// ───────────────────────────────────────────────────────────────────
// Mode detection
// ───────────────────────────────────────────────────────────────────

export type MnemoMode = "service" | "library";

export function getMnemoMode(): MnemoMode {
  return process.env["MNEMO_URL"] && process.env["MNEMO_API_KEY"] ? "service" : "library";
}

// Lazy SDK helpers — keep the cold-path imports out of library-mode hot
// paths so the in-process path doesn't pay the HTTP-SDK load cost.
async function loadSdk() {
  const [{ getMnemoClient }, { MnemosyneAPIError }] = await Promise.all([
    import("@/lib/mnemo/client"),
    import("@mnemosyne/client-ts"),
  ]);
  return { client: getMnemoClient(), MnemosyneAPIError };
}

// ───────────────────────────────────────────────────────────────────
// listWorkspaceFacts — paginated, filterable, FTS-capable list
// ───────────────────────────────────────────────────────────────────

/**
 * Shape returned to the route. Mirrors the legacy `/api/mnemo/facts`
 * response so the Inspector UI doesn't need to change.
 *
 * `items` carries the rich v1.6 projection (subject/statement/kind plus
 * cognitive columns). The SDK already returns that shape; library mode
 * builds it inline via raw SQL.
 */
/**
 * Standalone row shape (NOT extending `MemoryFact` from the SDK — that
 * type has narrow `exactOptionalPropertyTypes` semantics on optional
 * fields that don't play with the orchester wire shape, where the
 * route always sends `null`/`undefined` explicitly).
 */
export interface FactInspectorRow {
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
  lastRecalledAt: string | null;
  sourceMessageIds: string[];
  attributedTo: "user" | "assistant" | "system" | null;
  linkedMemoryIds: string[];
  metadata: Record<string, unknown>;
  status: "active" | "merged" | "forgotten";
  mergedIntoId: string | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
  memoryType: string | null;
  actorId: string | null;
  entityId: string | null;
  protocolVersion: string | null;
}

export interface ListFactsInspector {
  mode: MnemoMode;
  items: FactInspectorRow[];
  nextCursor: string | null;
  total: number;
}

export interface ListFactsParams {
  kind?: string;
  scope?: string;
  scopeRef?: string;
  status?: "active" | "forgotten" | "merged" | "all";
  pinned?: boolean;
  q?: string;
  sortBy?: "created_at" | "updated_at" | "relevance" | "hit_count";
  order?: "asc" | "desc";
  cursor?: string;
  asOf?: string;
  limit: number;
}

export async function listWorkspaceFacts(
  workspaceId: string,
  params: ListFactsParams
): Promise<ListFactsInspector> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { client } = await loadSdk();
    const res: ListFactsResponse = await client.listFacts({
      ...(params.kind ? { kind: params.kind as never } : {}),
      ...(params.scope ? { scope: params.scope as never } : {}),
      ...(params.scopeRef ? { scopeRef: params.scopeRef } : {}),
      status: params.status ?? "active",
      ...(params.pinned !== undefined ? { pinned: params.pinned } : {}),
      ...(params.q ? { q: params.q } : {}),
      ...(params.sortBy ? { sortBy: params.sortBy } : {}),
      ...(params.order ? { order: params.order } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.asOf ? { asOf: params.asOf } : {}),
      limit: params.limit,
    });
    // The upstream MemoryFact doesn't carry `entityId`/`protocolVersion`
    // today (they live in deps.MemoryFact as optional v1.6 fields). The
    // Inspector reads them, so when the server doesn't populate them we
    // pass through whatever the wire has — null/undefined remains
    // null/undefined, callers tolerate either.
    return {
      mode,
      // Service mode: project SDK MemoryFact → Inspector row. The
      // upstream wire doesn't carry `entityId` / `protocolVersion`
      // (host-domain fields), so we leave them as null — the Inspector
      // already tolerates null on these.
      items: res.items.map((f) => ({
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
        lastRecalledAt: f.lastRecalledAt,
        sourceMessageIds: f.sourceMessageIds,
        attributedTo: f.attributedTo,
        linkedMemoryIds: f.linkedMemoryIds,
        metadata: f.metadata,
        status: f.status,
        mergedIntoId: f.mergedIntoId,
        validFrom: f.validFrom,
        validTo: f.validTo,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        memoryType: f.memoryType ?? null,
        actorId: f.actorId ?? null,
        entityId: null,
        protocolVersion: null,
      })),
      nextCursor: res.nextCursor,
      total: res.total,
    };
  }

  // Library mode — mirror the legacy route's raw-SQL path verbatim.
  // The route did this work in withMnemoTx with a tagged-template
  // `sql` query; we keep the same SQL plan + RLS behaviour by
  // re-issuing it here. Same allowed columns / cursor codec / total
  // semantics, no UI changes required.
  const { withMnemoTx } = await import("@mnemosyne/core");
  const { sql } = await import("drizzle-orm");

  const SORT_COLUMNS: Record<NonNullable<ListFactsParams["sortBy"]>, string> = {
    created_at: "f.created_at",
    updated_at: "f.updated_at",
    relevance: "f.relevance",
    hit_count: "f.hit_count",
  };
  const sortByParam = params.sortBy ?? "updated_at";
  const orderParam = params.order ?? "desc";
  const isDesc = orderParam === "desc";
  const limit = Math.min(Math.max(params.limit, 1), 200);
  const statusParam = params.status ?? "active";

  // Decode the opaque cursor — same codec as the upstream factory uses
  // (base64url JSON of `{v,id}`). Malformed cursors fall through to
  // "start from the top" rather than 400'ing.
  let cursor: { v: string | number; id: string } | null = null;
  if (params.cursor) {
    try {
      const json = Buffer.from(params.cursor, "base64url").toString("utf8");
      const obj = JSON.parse(json) as Partial<{ v: string | number; id: string }>;
      if ((typeof obj.v === "string" || typeof obj.v === "number") && typeof obj.id === "string") {
        cursor = { v: obj.v, id: obj.id };
      }
    } catch {
      /* ignore */
    }
  }

  const conds: ReturnType<typeof sql>[] = [sql`f.workspace_id = ${workspaceId}`];
  if (statusParam !== "all") conds.push(sql`f.status = ${statusParam}`);
  if (params.kind) conds.push(sql`f.kind = ${params.kind}`);
  if (params.scope) conds.push(sql`f.scope = ${params.scope}`);
  if (params.scopeRef) conds.push(sql`f.scope_ref = ${params.scopeRef}`);
  if (params.pinned !== undefined) conds.push(sql`f.pinned = ${params.pinned}`);
  if (params.asOf) {
    conds.push(
      sql`f.valid_from <= ${params.asOf}::timestamptz AND (f.valid_to IS NULL OR f.valid_to > ${params.asOf}::timestamptz)`
    );
  }
  if (params.q && params.q.trim().length > 0) {
    conds.push(sql`(
      (f.text_lemmatized IS NOT NULL
        AND f.text_lemmatized @@ plainto_tsquery('simple', ${params.q}))
      OR f.statement ILIKE ${"%" + params.q + "%"}
    )`);
  }

  // Snapshot filter conditions before appending the cursor so `total`
  // counts the full filtered set (not just rows past the cursor).
  const filterConds = conds.slice();
  if (cursor) {
    const sortColumn = sql.raw(SORT_COLUMNS[sortByParam]);
    const isTimestamp = sortByParam === "created_at" || sortByParam === "updated_at";
    const cursorValue = isTimestamp ? String(cursor.v) : Number(cursor.v);
    if (isDesc) {
      conds.push(
        isTimestamp
          ? sql`(${sortColumn}, f.id) < (${cursorValue}::timestamptz, ${cursor.id})`
          : sql`(${sortColumn}, f.id) < (${cursorValue}::double precision, ${cursor.id})`
      );
    } else {
      conds.push(
        isTimestamp
          ? sql`(${sortColumn}, f.id) > (${cursorValue}::timestamptz, ${cursor.id})`
          : sql`(${sortColumn}, f.id) > (${cursorValue}::double precision, ${cursor.id})`
      );
    }
  }

  const whereSql = sql.join(conds, sql` AND `);
  const countWhereSql = sql.join(filterConds, sql` AND `);
  const dir = sql.raw(isDesc ? "DESC" : "ASC");
  const orderSql = sql`${sql.raw(SORT_COLUMNS[sortByParam])} ${dir}, f.id ${dir}`;

  type Row = {
    id: string;
    workspace_id: string;
    agent_id: string | null;
    scope: string;
    scope_ref: string | null;
    kind: string;
    subject: string;
    statement: string;
    confidence: number;
    pinned: boolean;
    relevance: number;
    hit_count: number;
    last_recalled_at: Date | null;
    source_message_ids: string[];
    attributed_to: string | null;
    metadata: Record<string, unknown>;
    status: string;
    created_at: Date;
    updated_at: Date;
    memory_type: string;
    attribution: string;
    actor_id: string | null;
    entity_id: string | null;
    protocol_version: string;
  };

  const { rows, total } = await withMnemoTx(workspaceId, async (tx) => {
    const rowsRaw = (await tx.execute(sql`
      SELECT
        f.id, f.workspace_id, f.agent_id, f.scope, f.scope_ref, f.kind,
        f.subject, f.statement, f.confidence, f.pinned, f.relevance,
        f.hit_count, f.last_recalled_at, f.source_message_ids,
        f.attributed_to, f.metadata, f.status, f.created_at, f.updated_at,
        f.memory_type, f.attribution, f.actor_id, f.entity_id,
        f.protocol_version
      FROM mnemo_fact f
      WHERE ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${limit + 1}
    `)) as unknown as Row[];
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM mnemo_fact f WHERE ${countWhereSql}
    `)) as unknown as Array<{ total: number }>;
    return { rows: rowsRaw, total: totalRows[0]?.total ?? 0 };
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1]!;
    const colValue =
      sortByParam === "created_at"
        ? new Date(last.created_at).toISOString()
        : sortByParam === "updated_at"
          ? new Date(last.updated_at).toISOString()
          : sortByParam === "relevance"
            ? Number(last.relevance)
            : Number(last.hit_count);
    nextCursor = Buffer.from(JSON.stringify({ v: colValue, id: last.id }), "utf8").toString(
      "base64url"
    );
  }

  return {
    mode,
    items: page.map(
      (r): FactInspectorRow => ({
        id: r.id,
        workspaceId: r.workspace_id,
        agentId: r.agent_id,
        scope: r.scope as FactInspectorRow["scope"],
        scopeRef: r.scope_ref,
        kind: r.kind as FactInspectorRow["kind"],
        subject: r.subject,
        statement: r.statement,
        confidence: Number(r.confidence),
        pinned: r.pinned,
        relevance: Number(r.relevance),
        hitCount: Number(r.hit_count),
        lastRecalledAt: r.last_recalled_at ? new Date(r.last_recalled_at).toISOString() : null,
        sourceMessageIds: r.source_message_ids,
        attributedTo: r.attributed_to as FactInspectorRow["attributedTo"],
        linkedMemoryIds: [],
        metadata: r.metadata ?? {},
        status: r.status as FactInspectorRow["status"],
        mergedIntoId: null,
        validFrom: new Date(r.created_at).toISOString(),
        validTo: null,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
        memoryType: r.memory_type ?? null,
        actorId: r.actor_id,
        entityId: r.entity_id,
        protocolVersion: r.protocol_version ?? null,
      })
    ),
    nextCursor,
    total,
  };
}

// ───────────────────────────────────────────────────────────────────
// getWorkspaceFact — single fact by id
// ───────────────────────────────────────────────────────────────────

export interface FactDetail {
  mode: MnemoMode;
  data: FactInspectorRow | null;
}

export async function getWorkspaceFact(workspaceId: string, id: string): Promise<FactDetail> {
  const mode = getMnemoMode();

  if (mode === "service") {
    // Service mode: there's no single-fact rich endpoint on the wire
    // (the upstream `/v1/facts/:id` returns the simplified `Fact`
    // shape, not the rich `MemoryFact`). Fall through to listFacts with
    // a single-fact filter — keys off the same FTS-extended endpoint
    // and returns the rich projection.
    const { client } = await loadSdk();
    // The upstream list endpoint doesn't filter by id; instead, we
    // re-use the helper's `q`-less variant with limit=1 and post-filter.
    // For a clean implementation we'd add `id` to ListFactsInput, but
    // that requires another wire change. As a pragmatic shortcut for
    // dual-mode parity right now, we ALSO call patchFact's read path
    // through a no-op... no — simpler: extend with a dedicated SDK
    // call. We just call client.getFact + map. That returns Fact (the
    // simplified shape) without `subject`, `kind`, etc. — not enough.
    // So: degrade gracefully — query listFacts({ limit: 500, status:
    // "all" }) and find by id. Inspector single-fact reads are rare
    // (user clicks a row); the perf hit is acceptable until a richer
    // `/v1/facts/:id` ships upstream.
    //
    // TODO(tramo-6): add a GET /v1/facts/:id?projection=rich endpoint
    // upstream and switch this to a 1-hop read.
    const res = await client.listFacts({ status: "all", limit: 500 });
    const hit = res.items.find((f) => f.id === id);
    if (!hit) return { mode, data: null };
    return {
      mode,
      data: {
        id: hit.id,
        workspaceId: hit.workspaceId,
        agentId: hit.agentId,
        scope: hit.scope,
        scopeRef: hit.scopeRef,
        kind: hit.kind,
        subject: hit.subject,
        statement: hit.statement,
        confidence: hit.confidence,
        pinned: hit.pinned,
        relevance: hit.relevance,
        hitCount: hit.hitCount,
        lastRecalledAt: hit.lastRecalledAt,
        sourceMessageIds: hit.sourceMessageIds,
        attributedTo: hit.attributedTo,
        linkedMemoryIds: hit.linkedMemoryIds ?? [],
        metadata: hit.metadata,
        status: hit.status,
        mergedIntoId: hit.mergedIntoId,
        validFrom: hit.validFrom,
        validTo: hit.validTo,
        createdAt: hit.createdAt,
        updatedAt: hit.updatedAt,
        memoryType: hit.memoryType ?? null,
        actorId: hit.actorId ?? null,
        entityId: null,
        protocolVersion: null,
      },
    };
  }

  // Library mode — re-issue the legacy route's single-fact read.
  const { withMnemoTx } = await import("@mnemosyne/core");
  const { sql } = await import("drizzle-orm");

  type Row = {
    id: string;
    workspace_id: string;
    agent_id: string | null;
    scope: string;
    scope_ref: string | null;
    kind: string;
    subject: string;
    statement: string;
    confidence: number;
    pinned: boolean;
    relevance: number;
    hit_count: number;
    last_recalled_at: Date | null;
    source_message_ids: string[];
    attributed_to: string | null;
    linked_memory_ids: string[];
    metadata: Record<string, unknown>;
    status: string;
    created_at: Date;
    updated_at: Date;
    memory_type: string;
    attribution: string;
    actor_id: string | null;
    entity_id: string | null;
    protocol_version: string;
    valid_from: Date;
    valid_to: Date | null;
  };

  const row = await withMnemoTx(workspaceId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        f.id, f.workspace_id, f.agent_id, f.scope, f.scope_ref, f.kind,
        f.subject, f.statement, f.confidence, f.pinned, f.relevance,
        f.hit_count, f.last_recalled_at, f.source_message_ids,
        f.attributed_to, f.linked_memory_ids, f.metadata, f.status,
        f.created_at, f.updated_at,
        f.memory_type, f.attribution, f.actor_id, f.entity_id,
        f.protocol_version, f.valid_from, f.valid_to
      FROM mnemo_fact f
      WHERE f.workspace_id = ${workspaceId} AND f.id = ${id}
      LIMIT 1
    `)) as unknown as Row[];
    return rows[0] ?? null;
  });

  if (!row) return { mode, data: null };
  return {
    mode,
    data: {
      id: row.id,
      workspaceId: row.workspace_id,
      agentId: row.agent_id,
      scope: row.scope as FactInspectorRow["scope"],
      scopeRef: row.scope_ref,
      kind: row.kind as FactInspectorRow["kind"],
      subject: row.subject,
      statement: row.statement,
      confidence: Number(row.confidence),
      pinned: row.pinned,
      relevance: Number(row.relevance),
      hitCount: Number(row.hit_count),
      lastRecalledAt: row.last_recalled_at ? new Date(row.last_recalled_at).toISOString() : null,
      sourceMessageIds: row.source_message_ids,
      attributedTo: row.attributed_to as FactInspectorRow["attributedTo"],
      linkedMemoryIds: row.linked_memory_ids,
      metadata: row.metadata ?? {},
      status: row.status as FactInspectorRow["status"],
      mergedIntoId: null,
      validFrom: new Date(row.valid_from).toISOString(),
      validTo: row.valid_to ? new Date(row.valid_to).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      memoryType: row.memory_type ?? null,
      actorId: row.actor_id,
      entityId: row.entity_id,
      protocolVersion: row.protocol_version ?? null,
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// patchWorkspaceFact — PATCH editable columns
// ───────────────────────────────────────────────────────────────────

/**
 * Update mutable fact columns. Returns `data: null` when the fact
 * doesn't exist (route maps → 404).
 *
 * The returned shape mirrors what the legacy orchester route returned
 * (a subset of fields, not the full MemoryFact) so the Inspector's
 * cache invalidation logic stays unchanged.
 */
export async function patchWorkspaceFact(
  workspaceId: string,
  id: string,
  patch: PatchFactInput
): Promise<{
  mode: MnemoMode;
  data: {
    id: string;
    statement: string;
    kind: string;
    subject: string;
    confidence: number;
    pinned: boolean;
    status: string;
    metadata: Record<string, unknown>;
    updatedAt: Date | string;
  } | null;
}> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { client, MnemosyneAPIError } = await loadSdk();
    try {
      const updated = await client.patchFact(id, patch);
      return {
        mode,
        data: {
          id: updated.id,
          statement: updated.statement,
          kind: updated.kind,
          subject: updated.subject,
          confidence: updated.confidence,
          pinned: updated.pinned,
          status: updated.status,
          metadata: updated.metadata,
          updatedAt: updated.updatedAt,
        },
      };
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  // Library mode — mirror the legacy route's drizzle update.
  const { withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { and, eq } = await import("drizzle-orm");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.statement !== undefined) set["statement"] = patch.statement;
  if (patch.kind !== undefined) set["kind"] = patch.kind;
  if (patch.subject !== undefined) set["subject"] = patch.subject;
  if (patch.confidence !== undefined) set["confidence"] = patch.confidence;
  if (patch.pinned !== undefined) set["pinned"] = patch.pinned;
  if (patch.metadata !== undefined) set["metadata"] = patch.metadata;

  const updated = await withMnemoTx(workspaceId, async (tx) => {
    const _tx = tx as unknown as DbClient;
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set(set)
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, workspaceId)))
      .returning({
        id: schema.mnemoFacts.id,
        statement: schema.mnemoFacts.statement,
        kind: schema.mnemoFacts.kind,
        subject: schema.mnemoFacts.subject,
        confidence: schema.mnemoFacts.confidence,
        pinned: schema.mnemoFacts.pinned,
        status: schema.mnemoFacts.status,
        metadata: schema.mnemoFacts.metadata,
        updatedAt: schema.mnemoFacts.updatedAt,
      });
    return rows[0] ?? null;
  });

  if (!updated) return { mode, data: null };
  return {
    mode,
    data: {
      id: updated.id,
      statement: updated.statement,
      kind: updated.kind,
      subject: updated.subject,
      confidence: Number(updated.confidence),
      pinned: updated.pinned,
      status: updated.status,
      metadata: (updated.metadata as Record<string, unknown>) ?? {},
      updatedAt: updated.updatedAt,
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// pinWorkspaceFact / unpinWorkspaceFact
// ───────────────────────────────────────────────────────────────────

/**
 * Result shape for pin/unpin/forget — matches the legacy routes'
 * responses (minimal `{id, pinned/status, metadata?}`).
 */
export interface FactWriteResult {
  mode: MnemoMode;
  data: {
    id: string;
    pinned?: boolean;
    status?: string;
    metadata?: Record<string, unknown>;
  } | null;
}

/**
 * Pin a fact. Clears `metadata.auto_pinned_overridden` if set — the
 * user is explicitly re-affirming, so the auto-pin cron is free to
 * keep affirming on future passes.
 *
 * Service mode does this as a single PATCH: we don't need to read
 * current metadata because dropping a key idempotently means we only
 * need to know what the new metadata SHOULD look like. We send
 * `metadata: undefined` (i.e. omit it) when there's nothing to drop
 * — but we can't tell from outside whether `auto_pinned_overridden`
 * is set without a read. Trade-off: in service mode we always send a
 * 2-step PATCH (read current → drop key → write) so behaviour
 * matches library mode exactly. Pin/unpin are user-initiated and
 * rare; the extra round-trip is acceptable.
 */
export async function pinWorkspaceFact(workspaceId: string, id: string): Promise<FactWriteResult> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { client, MnemosyneAPIError } = await loadSdk();
    try {
      // Read current to compute new metadata.
      const current = await client.getFact(id);
      const currentMeta = (current.attribution as Record<string, unknown>) ?? {};
      const newMeta: Record<string, unknown> = { ...currentMeta };
      delete newMeta["auto_pinned_overridden"];

      const updated = await client.patchFact(id, {
        pinned: true,
        metadata: newMeta,
      });
      return {
        mode,
        data: { id: updated.id, pinned: updated.pinned, metadata: updated.metadata },
      };
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  // Library mode — keep the legacy route's inline jsonb '-' op so
  // we don't have to read + write in two steps.
  const { withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { and, eq, sql } = await import("drizzle-orm");

  const updated = await withMnemoTx(workspaceId, async (tx) => {
    const _tx = tx as unknown as DbClient;
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set({
        pinned: true,
        updatedAt: new Date(),
        metadata: sql`COALESCE(${schema.mnemoFacts.metadata}, '{}'::jsonb) - 'auto_pinned_overridden'`,
      })
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, workspaceId)))
      .returning({
        id: schema.mnemoFacts.id,
        pinned: schema.mnemoFacts.pinned,
        metadata: schema.mnemoFacts.metadata,
      });
    return rows[0] ?? null;
  });
  if (!updated) return { mode, data: null };
  return {
    mode,
    data: {
      id: updated.id,
      pinned: updated.pinned,
      metadata: (updated.metadata as Record<string, unknown>) ?? {},
    },
  };
}

/**
 * Unpin a fact. If the fact had been auto-pinned (metadata.auto_pinned
 * is set), stamps `metadata.auto_pinned_overridden = true` so the
 * cron stops re-pinning. A user-pinned fact getting unpinned is just
 * a normal unpin — the override flag is reserved for "override the
 * automation's decision".
 */
export async function unpinWorkspaceFact(
  workspaceId: string,
  id: string
): Promise<FactWriteResult> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { client, MnemosyneAPIError } = await loadSdk();
    try {
      const current = await client.getFact(id);
      const currentMeta = (current.attribution as Record<string, unknown>) ?? {};
      const newMeta: Record<string, unknown> = { ...currentMeta };
      if ("auto_pinned" in currentMeta) {
        newMeta["auto_pinned_overridden"] = true;
      }
      const updated = await client.patchFact(id, {
        pinned: false,
        metadata: newMeta,
      });
      return {
        mode,
        data: { id: updated.id, pinned: updated.pinned, metadata: updated.metadata },
      };
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  const { withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { and, eq, sql } = await import("drizzle-orm");

  const updated = await withMnemoTx(workspaceId, async (tx) => {
    const _tx = tx as unknown as DbClient;
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set({
        pinned: false,
        updatedAt: new Date(),
        metadata: sql`
          CASE
            WHEN COALESCE(${schema.mnemoFacts.metadata}, '{}'::jsonb) ? 'auto_pinned'
              THEN COALESCE(${schema.mnemoFacts.metadata}, '{}'::jsonb)
                   || jsonb_build_object('auto_pinned_overridden', true)
            ELSE COALESCE(${schema.mnemoFacts.metadata}, '{}'::jsonb)
          END
        `,
      })
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, workspaceId)))
      .returning({
        id: schema.mnemoFacts.id,
        pinned: schema.mnemoFacts.pinned,
        metadata: schema.mnemoFacts.metadata,
      });
    return rows[0] ?? null;
  });
  if (!updated) return { mode, data: null };
  return {
    mode,
    data: {
      id: updated.id,
      pinned: updated.pinned,
      metadata: (updated.metadata as Record<string, unknown>) ?? {},
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// forgetWorkspaceFact
// ───────────────────────────────────────────────────────────────────

/**
 * Soft-delete a fact: status='forgotten'. Reverse of
 * {@link restoreWorkspaceFact}. Service mode uses the upstream
 * `forgetFact` (which closes the bitemporal interval too); library
 * mode keeps the legacy semantics of flipping status only.
 *
 * Library mode parity note: the legacy route only set `status`,
 * NOT `valid_to`. Service mode (via upstream forgetFact) ALSO sets
 * `valid_to = now()`. This is a deliberate behavior unification —
 * the bitemporal interval is the source of truth, and matching
 * library mode would require a separate library-side write path.
 * The Inspector treats both identically (status='forgotten' →
 * "Forgotten" badge), so no UI regression.
 */
export async function forgetWorkspaceFact(
  workspaceId: string,
  id: string
): Promise<FactWriteResult> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { client, MnemosyneAPIError } = await loadSdk();
    try {
      await client.forgetFact(id);
      return { mode, data: { id, status: "forgotten" } };
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  const { withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { and, eq } = await import("drizzle-orm");

  const updated = await withMnemoTx(workspaceId, async (tx) => {
    const _tx = tx as unknown as DbClient;
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set({ status: "forgotten", updatedAt: new Date() })
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, workspaceId)))
      .returning({
        id: schema.mnemoFacts.id,
        status: schema.mnemoFacts.status,
      });
    return rows[0] ?? null;
  });
  if (!updated) return { mode, data: null };
  return { mode, data: { id: updated.id, status: updated.status } };
}

// ───────────────────────────────────────────────────────────────────
// restoreWorkspaceFact (carried over from tramo 3)
// ───────────────────────────────────────────────────────────────────

export async function restoreWorkspaceFact(
  workspaceId: string,
  id: string
): Promise<{ mode: MnemoMode; data: RestoreFactResponse | null }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { client, MnemosyneAPIError } = await loadSdk();
    try {
      const data = await client.restoreFact(id);
      return { mode, data };
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  const { withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { and, eq } = await import("drizzle-orm");

  const updated = await withMnemoTx(workspaceId, async (tx) => {
    const _tx = tx as unknown as DbClient;
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, workspaceId)))
      .returning({
        id: schema.mnemoFacts.id,
        status: schema.mnemoFacts.status,
      });
    return rows[0] ?? null;
  });

  if (!updated) return { mode, data: null };
  return { mode, data: { id: updated.id, status: "active" as const } };
}

// ───────────────────────────────────────────────────────────────────
// getWorkspaceFactCitations — HYBRID
// ───────────────────────────────────────────────────────────────────

export interface FactCitationsResponse {
  mode: MnemoMode;
  data: {
    citations: Array<{
      id: string;
      role: string;
      content: string;
      conversationId: string;
      createdAt: Date | string;
    }>;
  } | null;
}

/**
 * Source citations for a fact.
 *
 * Hybrid by design: the upstream `getFactCitations` returns only the
 * source-message-id list (because `message` is host-domain), so we
 * fetch ids from there in service mode, and ALWAYS join orchester's
 * `message` + `conversation` tables host-side to materialise the
 * actual citation rows (role, content, timestamps).
 *
 * Returns `data: null` when the fact doesn't exist.
 */
export async function getWorkspaceFactCitations(
  workspaceId: string,
  id: string
): Promise<FactCitationsResponse> {
  const mode = getMnemoMode();

  let ids: string[] | null = null;

  if (mode === "service") {
    const { client, MnemosyneAPIError } = await loadSdk();
    try {
      const result = await client.getFactCitations(id);
      ids = result.sourceMessageIds;
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  } else {
    const { withMnemoTx } = await import("@mnemosyne/core");
    const { sql } = await import("drizzle-orm");
    const row = await withMnemoTx(workspaceId, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id, source_message_ids
        FROM mnemo_fact
        WHERE workspace_id = ${workspaceId} AND id = ${id}
        LIMIT 1
      `)) as unknown as Array<{ id: string; source_message_ids: string[] }>;
      return rows[0] ?? null;
    });
    if (!row) return { mode, data: null };
    ids = row.source_message_ids ?? [];
  }

  if (!ids || ids.length === 0) {
    return { mode, data: { citations: [] } };
  }

  // Host-side JOIN: messages live outside the mnemo_* tables and
  // scope via conversation.workspace_id. Same query the legacy route
  // used.
  const { getDb } = await import("@orchester/db");
  const { sql } = await import("drizzle-orm");
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT m.id, m.role, m.content, m.conversation_id, m.created_at
    FROM message m
    INNER JOIN conversation c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
      AND m.id = ANY(${sql.param(ids)}::text[])
    ORDER BY m.created_at ASC
  `)) as unknown as Array<{
    id: string;
    role: string;
    content: string;
    conversation_id: string;
    created_at: Date;
  }>;

  return {
    mode,
    data: {
      citations: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        conversationId: r.conversation_id,
        createdAt: r.created_at,
      })),
    },
  };
}
