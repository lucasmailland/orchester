// apps/web/lib/mnemo/facts.ts
//
// HTTP-only implementation of the orchester `/api/mnemo/facts*` route
// family. Every helper here delegates to @mnemosyne/client-ts — the
// in-process @mnemosyne/core path was retired with Phase 3.
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
import type { ListFactsResponse, PatchFactInput, RestoreFactResponse } from "@mnemosyne/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

// Re-exports kept for source compatibility with callers that imported
// the local copies during dual-mode.
export { getMnemoMode };
export type { MnemoMode };

// Lazy SDK error import — keep the cold-path imports out of the hot
// list/get paths so the typical request doesn't pay the load cost.
async function getMnemoApiError() {
  const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
  return MnemosyneAPIError;
}

// ───────────────────────────────────────────────────────────────────
// Inspector wire shape
// ───────────────────────────────────────────────────────────────────

/**
 * Inspector row — standalone shape (NOT extending `MemoryFact` from
 * the SDK because the SDK type has narrow `exactOptionalPropertyTypes`
 * semantics on optional fields that don't play with the orchester wire
 * shape, where the route always sends `null` / `undefined` explicitly).
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

// ───────────────────────────────────────────────────────────────────
// listWorkspaceFacts
// ───────────────────────────────────────────────────────────────────

export async function listWorkspaceFacts(
  _workspaceId: string,
  params: ListFactsParams
): Promise<ListFactsInspector> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
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
  return {
    mode,
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

// ───────────────────────────────────────────────────────────────────
// getWorkspaceFact
// ───────────────────────────────────────────────────────────────────

export interface FactDetail {
  mode: MnemoMode;
  data: FactInspectorRow | null;
}

export async function getWorkspaceFact(_workspaceId: string, id: string): Promise<FactDetail> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  // The upstream wire doesn't ship a "rich projection" single-fact
  // endpoint yet — fall through to listFacts({status:"all", limit:500})
  // and find by id. Acceptable for inspector single-fact reads (user
  // clicked a row); upgrades to a dedicated endpoint in a future tramo.
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

// ───────────────────────────────────────────────────────────────────
// patchWorkspaceFact
// ───────────────────────────────────────────────────────────────────

export async function patchWorkspaceFact(
  _workspaceId: string,
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
  const client = getMnemoClient();
  const MnemosyneAPIError = await getMnemoApiError();
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

// ───────────────────────────────────────────────────────────────────
// pinWorkspaceFact / unpinWorkspaceFact
// ───────────────────────────────────────────────────────────────────

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
 * Implementation: GET current to read metadata, then PATCH with the
 * combined `{pinned, metadata}`. Two-call sequence is acceptable —
 * pin/unpin are user-initiated and rare.
 */
export async function pinWorkspaceFact(_workspaceId: string, id: string): Promise<FactWriteResult> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const MnemosyneAPIError = await getMnemoApiError();
  try {
    const current = await client.getFact(id);
    const currentMeta = (current.attribution as Record<string, unknown>) ?? {};
    const newMeta: Record<string, unknown> = { ...currentMeta };
    delete newMeta["auto_pinned_overridden"];
    const updated = await client.patchFact(id, { pinned: true, metadata: newMeta });
    return { mode, data: { id: updated.id, pinned: updated.pinned, metadata: updated.metadata } };
  } catch (e) {
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }
}

/**
 * Unpin a fact. If the fact had been auto-pinned (metadata.auto_pinned
 * is set), stamps `metadata.auto_pinned_overridden = true` so the
 * cron stops re-pinning. A user-pinned fact getting unpinned is just
 * a normal unpin — the override flag is reserved for "override the
 * automation's decision".
 */
export async function unpinWorkspaceFact(
  _workspaceId: string,
  id: string
): Promise<FactWriteResult> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const MnemosyneAPIError = await getMnemoApiError();
  try {
    const current = await client.getFact(id);
    const currentMeta = (current.attribution as Record<string, unknown>) ?? {};
    const newMeta: Record<string, unknown> = { ...currentMeta };
    if ("auto_pinned" in currentMeta) {
      newMeta["auto_pinned_overridden"] = true;
    }
    const updated = await client.patchFact(id, { pinned: false, metadata: newMeta });
    return { mode, data: { id: updated.id, pinned: updated.pinned, metadata: updated.metadata } };
  } catch (e) {
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }
}

// ───────────────────────────────────────────────────────────────────
// forgetWorkspaceFact
// ───────────────────────────────────────────────────────────────────

/**
 * Soft-delete a fact via the upstream forgetFact endpoint (closes the
 * bitemporal interval and flips status='forgotten'). Reverse of
 * {@link restoreWorkspaceFact}.
 */
export async function forgetWorkspaceFact(
  _workspaceId: string,
  id: string
): Promise<FactWriteResult> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const MnemosyneAPIError = await getMnemoApiError();
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

// ───────────────────────────────────────────────────────────────────
// restoreWorkspaceFact
// ───────────────────────────────────────────────────────────────────

export async function restoreWorkspaceFact(
  _workspaceId: string,
  id: string
): Promise<{ mode: MnemoMode; data: RestoreFactResponse | null }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const MnemosyneAPIError = await getMnemoApiError();
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

// ───────────────────────────────────────────────────────────────────
// getWorkspaceFactCitations — HYBRID (mnemo + orchester message JOIN)
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
 * fetch ids from there and ALWAYS join orchester's `message` +
 * `conversation` tables host-side to materialise the actual citation
 * rows (role, content, timestamps).
 *
 * Returns `data: null` when the fact doesn't exist.
 */
export async function getWorkspaceFactCitations(
  workspaceId: string,
  id: string
): Promise<FactCitationsResponse> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const MnemosyneAPIError = await getMnemoApiError();

  let ids: string[];
  try {
    const result = await client.getFactCitations(id);
    ids = result.sourceMessageIds;
  } catch (e) {
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }

  if (ids.length === 0) {
    return { mode, data: { citations: [] } };
  }

  // Host-side JOIN: messages live outside the mnemo_* tables and
  // scope via conversation.workspace_id.
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
