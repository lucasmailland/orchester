// PATCH /api/workspaces/[slug]/brain/relations/[id]
//
// Apply a human judgment to a pending relation: replace the verb, set
// confidence/reason, stamp markedByKind='user'. editor+ (brain.write).
// patchRelation requires `relation` (types.ts:891) — the schema enforces it.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { patchWorkspaceRelation } from "@/lib/mnemo/relations";
import { relationVerbEnum } from "@/lib/mnemo/relation-verbs";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  relation: relationVerbEnum, // REQUIRED — see types.ts:891
  reason: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { slug, id } = await params;

  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.id !== ctx.workspace.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = isAccessible(ws);
  if (!access.ok)
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "deleted" ? 410 : 423 }
    );
  try {
    assertCan(ctx.role, "brain.write");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;

  try {
    const { mode, data } = await patchWorkspaceRelation(ctx.workspace.id, id, {
      relation: b.relation,
      markedByKind: "user",
      markedByUserId: ctx.user.id,
      ...(b.reason !== undefined ? { reason: b.reason } : {}),
      ...(b.confidence !== undefined ? { confidence: b.confidence } : {}),
    });
    if (!data) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: { "X-Mnemo-Mode": mode } }
      );
    }
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "mnemo.relation.judge",
      resource: "mnemo_relation",
      resourceId: id,
      after: { relation: data.relation, confidence: data.confidence },
    });
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[brain/relations/:id] patch failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
