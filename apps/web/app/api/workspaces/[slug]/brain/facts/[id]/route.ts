// GET    /api/workspaces/[slug]/brain/facts/[id]
// PATCH  /api/workspaces/[slug]/brain/facts/[id]   — pin/edit (admin)
// DELETE /api/workspaces/[slug]/brain/facts/[id]   — soft-delete to forgotten
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { forgetFact, getFact, updateFact, withBrainTx } from "@/lib/brain";
import { appendAudit } from "@/lib/audit/log";
import { invalidateRecallCache } from "@/lib/brain/recall";

/**
 * Per-handler context loader. `minRole` is parameterised because the same
 * loader serves the read path (GET → viewer) and the write paths
 * (PATCH/DELETE → editor). Failing the auth gate at the lowest tier the
 * handler can tolerate keeps `assertCan(role, "brain.write")` from being
 * the only line of defense; if the RBAC predicate ever drifts, the auth
 * layer still rejects a viewer token at the door.
 */
async function loadCtx(req: NextRequest, slug: string, minRole: "viewer" | "editor" | "admin") {
  void req;
  const ctx = await requireAuth({ minRole });
  if (!isAuthContext(ctx)) return { err: ctx };
  const ws = await resolveBySlug(slug);
  if (!ws) return { err: NextResponse.json({ error: "workspace_not_found" }, { status: 404 }) };
  if (ws.id !== ctx.workspace.id)
    return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  const access = isAccessible(ws);
  if (!access.ok) {
    return {
      err: NextResponse.json(
        { error: access.reason },
        { status: access.reason === "deleted" ? 410 : 423 }
      ),
    };
  }
  return { ctx, ws };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  const r = await loadCtx(req, slug, "viewer");
  if ("err" in r) return r.err;
  try {
    assertCan(r.ctx.role, "brain.read");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }
  const fact = await withBrainTx(r.ws.id, (tx) => getFact(r.ws.id, id, tx));
  if (!fact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ fact: { ...fact, embedding: undefined } });
}

const PatchSchema = z.object({
  statement: z.string().min(10).max(400).optional(),
  subject: z.string().min(1).max(80).optional(),
  kind: z
    .enum(["preference", "trait", "event", "relationship", "skill", "concern", "other"])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  pinned: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  const r = await loadCtx(req, slug, "editor");
  if ("err" in r) return r.err;
  try {
    assertCan(r.ctx.role, "brain.write");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }
  const parsed = await parseBody(req, PatchSchema);
  if (!parsed.ok) return parsed.response;

  // Strip undefined keys — zod returns `T | undefined` per field but
  // store.updateFact's exactOptionalPropertyTypes target requires
  // keys to be present-with-value OR absent.
  const cleanPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) cleanPatch[k] = v;
  }
  const updated = await withBrainTx(r.ws.id, (tx) =>
    updateFact({
      workspaceId: r.ws.id,
      factId: id,
      patch: cleanPatch as Parameters<typeof updateFact>[0]["patch"],
      tx,
    })
  );
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  invalidateRecallCache(r.ws.id);

  // Fire-and-forget by design — `appendAudit` returns void and logs
  // its own errors via `safeLogError`. Per-record fact mutations match
  // the project-wide pattern; workspace lifecycle events use
  // `appendAuditSync` instead because they're audit-critical.
  appendAudit(r.ws.id, {
    action: "brain.fact.update",
    actorUserId: r.ctx.user.id,
    actorKind: "user",
    targetType: "brain_fact",
    targetId: id,
    meta: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json({ fact: { ...updated, embedding: undefined } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  const r = await loadCtx(req, slug, "editor");
  if ("err" in r) return r.err;
  try {
    assertCan(r.ctx.role, "brain.write");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  await withBrainTx(r.ws.id, (tx) => forgetFact(r.ws.id, id, tx));
  invalidateRecallCache(r.ws.id);

  // Fire-and-forget (see note in PATCH handler above).
  appendAudit(r.ws.id, {
    action: "brain.fact.forget",
    actorUserId: r.ctx.user.id,
    actorKind: "user",
    targetType: "brain_fact",
    targetId: id,
    meta: {},
  });

  return NextResponse.json({ ok: true });
}
