// apps/web/app/api/mnemo/facts/[id]/route.ts
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
// RBAC: editor+. parseBody enforces zod validation.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import { withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

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
    const rows = await tx
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
