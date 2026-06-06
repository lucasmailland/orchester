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
// Tramo 5 dual-mode: the dual-mode work lives in
// `lib/mnemo/facts.getWorkspaceFact / patchWorkspaceFact`. This route
// stays thin — parsing, validation, RBAC, audit.
//
// RBAC: GET viewer+, PATCH editor+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { getWorkspaceFact, patchWorkspaceFact } from "@/lib/mnemo/facts";

export const dynamic = "force-dynamic";

// ────────────────────────────────────────────────────────────────────────
// GET /api/mnemo/facts/[id]
// ────────────────────────────────────────────────────────────────────────
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const result = await getWorkspaceFact(ctx.workspace.id, id);
  if (!result.data) {
    const r = NextResponse.json({ error: "Not found" }, { status: 404 });
    r.headers.set("X-Mnemo-Mode", result.mode);
    return r;
  }
  const r = NextResponse.json(result.data);
  r.headers.set("X-Mnemo-Mode", result.mode);
  return r;
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
  // UPDATE that bumps updatedAt.
  if (
    body.statement === undefined &&
    body.kind === undefined &&
    body.subject === undefined &&
    body.confidence === undefined &&
    body.metadata === undefined
  ) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const result = await patchWorkspaceFact(ctx.workspace.id, id, {
    ...(body.statement !== undefined ? { statement: body.statement } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.subject !== undefined ? { subject: body.subject } : {}),
    ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  });

  if (!result.data) {
    const r = NextResponse.json({ error: "Not found" }, { status: 404 });
    r.headers.set("X-Mnemo-Mode", result.mode);
    return r;
  }

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.fact.update",
    resource: "mnemo_fact",
    resourceId: result.data.id,
    after: {
      fieldsTouched: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined),
    },
  });

  const r = NextResponse.json(result.data);
  r.headers.set("X-Mnemo-Mode", result.mode);
  return r;
}
