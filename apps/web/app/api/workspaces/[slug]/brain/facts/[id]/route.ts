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

async function loadCtx(req: NextRequest, slug: string) {
  void req;
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return { err: ctx };
  const ws = await resolveBySlug(slug);
  if (!ws) return { err: NextResponse.json({ error: "workspace_not_found" }, { status: 404 }) };
  if (ws.id !== ctx.workspace.id) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const r = await loadCtx(req, slug);
  if ("err" in r) return r.err;
  try { assertCan(r.ctx.role, "brain.read"); }
  catch { return NextResponse.json({ error: "role_insufficient" }, { status: 403 }); }
  const fact = await withBrainTx(r.ws.id, (tx) => getFact(r.ws.id, id, tx));
  if (!fact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ fact: { ...fact, embedding: undefined } });
}

const PatchSchema = z.object({
  statement: z.string().min(10).max(400).optional(),
  subject: z.string().min(1).max(80).optional(),
  kind: z.enum(["preference", "trait", "event", "relationship", "skill", "concern", "other"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  pinned: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const r = await loadCtx(req, slug);
  if ("err" in r) return r.err;
  try { assertCan(r.ctx.role, "brain.write"); }
  catch { return NextResponse.json({ error: "role_insufficient" }, { status: 403 }); }
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const r = await loadCtx(req, slug);
  if ("err" in r) return r.err;
  try { assertCan(r.ctx.role, "brain.write"); }
  catch { return NextResponse.json({ error: "role_insufficient" }, { status: 403 }); }

  await withBrainTx(r.ws.id, (tx) => forgetFact(r.ws.id, id, tx));
  invalidateRecallCache(r.ws.id);

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
