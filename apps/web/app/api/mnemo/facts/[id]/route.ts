// apps/web/app/api/mnemo/facts/[id]/route.ts
//
// GET   /api/mnemo/facts/[id] — fetch a single fact by id. Returns 404
//       when the fact doesn't exist OR is not visible to the caller's
//       workspace (RLS+FORCE prevents cross-workspace reads at the DB
//       layer, so a "not found" here is indistinguishable from a row
//       that lives in another tenant — by design).
//
// PATCH /api/mnemo/facts/[id] — update mutable fields on a fact.
// Editable: statement, kind, subject, confidence, metadata. Other
// columns (workspace_id, agent_id, scope, status, embedding,
// hit_count, …) flow through their own dedicated routes
// (pin/unpin/forget/restore) or are system-owned.
//
// When `statement` changes the embedding becomes stale. v1.3
// strategy: leave the existing embedding in place and let the next
// recall cycle naturally pull a fresh one (FTS continues to work
// against the new lemmatized statement immediately). Re-embedding
// on edit is a v1.4 polish — we don't fire-and-forget enqueue here
// to keep the route ergonomic and the tx atomic.
//
// RBAC: GET viewer+, PATCH editor+. parseBody enforces zod validation.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { schema, type DbClient } from "@orchester/db";
import { withMnemoTx } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// ────────────────────────────────────────────────────────────────────────
// GET /api/mnemo/facts/[id]
// ────────────────────────────────────────────────────────────────────────
//
// The Inspector's `useBrainFact(id)` hook used to call the LIST route
// with `?id=…&limit=1`, which silently ignored the id and returned an
// arbitrary fact (and 500'd on certain edge cases). This handler is
// the single source of truth for "fetch one by id".
//
// Selects ALL v1.6 cognitive columns so the detail panel + future
// chips have everything they need without a follow-up call.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

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

  const row = await withMnemoTx(ctx.workspace.id, async (tx) => {
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
      WHERE f.workspace_id = ${ctx.workspace.id}
        AND f.id = ${id}
      LIMIT 1
    `)) as unknown as Row[];
    return rows[0] ?? null;
  });

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    scope: row.scope,
    scopeRef: row.scope_ref,
    kind: row.kind,
    subject: row.subject,
    statement: row.statement,
    confidence: Number(row.confidence),
    pinned: row.pinned,
    relevance: Number(row.relevance),
    hitCount: Number(row.hit_count),
    lastRecalledAt: row.last_recalled_at,
    sourceMessageIds: row.source_message_ids,
    attributedTo: row.attributed_to,
    linkedMemoryIds: row.linked_memory_ids,
    metadata: row.metadata ?? {},
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memoryType: row.memory_type,
    attribution: row.attribution,
    actorId: row.actor_id,
    entityId: row.entity_id,
    protocolVersion: row.protocol_version,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  });
}

const KIND_VALUES = [
  "preference",
  "trait",
  "event",
  "relationship",
  "skill",
  "concern",
  "other",
] as const;

const patchFactSchema = z.object({
  statement: z.string().trim().min(1).max(4000).optional(),
  kind: z.enum(KIND_VALUES).optional(),
  subject: z.string().trim().min(1).max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  const parsed = await parseBody(req, patchFactSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Empty patch → 400. Cheaper to error early than to issue a no-op
  // UPDATE that touches updatedAt.
  if (
    body.statement === undefined &&
    body.kind === undefined &&
    body.subject === undefined &&
    body.confidence === undefined &&
    body.metadata === undefined
  ) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.statement !== undefined) set.statement = body.statement;
  if (body.kind !== undefined) set.kind = body.kind;
  if (body.subject !== undefined) set.subject = body.subject;
  if (body.confidence !== undefined) set.confidence = body.confidence;
  if (body.metadata !== undefined) set.metadata = body.metadata;

  const updated = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const _tx = tx as unknown as DbClient;
    // Schema bridge: withMnemoTx types tx against @mnemosyne/core's schema, but this
    // file uses @orchester/db's schema objects. Drizzle's fluent builder (.update/.set/.where)
    // uses SQL column name strings, not schema identity, so generated SQL is identical.
    // Safe for fluent builder only — never use db.query.* on _tx. See instrumentation-node.ts.
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set(set)
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, ctx.workspace.id)))
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

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.fact.update",
    resource: "mnemo_fact",
    resourceId: updated.id,
    after: {
      fieldsTouched: Object.keys(set).filter((k) => k !== "updatedAt"),
    },
  });

  return NextResponse.json(updated);
}
