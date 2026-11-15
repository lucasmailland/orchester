// POST /api/workspaces/[slug]/brain/conflicts/[id]/resolve  — editor+ (brain.write)
// [id] is the conflict's relationId. action ∈ {supersede_a, supersede_b,
// keep_both, merge}; mergedStatement REQUIRED iff action='merge' (types.ts:1747).
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { resolveWorkspaceConflict } from "@/lib/mnemo/judge";
import { z } from "zod";

export const dynamic = "force-dynamic";

const resolveSchema = z
  .object({
    action: z.enum(["supersede_a", "supersede_b", "keep_both", "merge"]),
    mergedStatement: z.string().min(1).max(4000).optional(),
  })
  .refine((v) => v.action !== "merge" || (v.mergedStatement?.trim().length ?? 0) > 0, {
    message: "mergedStatement is required when action='merge'",
    path: ["mergedStatement"],
  });

export async function POST(
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

  const parsed = await parseBody(req, resolveSchema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;

  try {
    const { mode, data } = await resolveWorkspaceConflict(ctx.workspace.id, id, {
      action: b.action,
      ...(b.mergedStatement !== undefined ? { mergedStatement: b.mergedStatement } : {}),
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
      action: "mnemo.conflict.resolve",
      resource: "mnemo_relation",
      resourceId: id,
      after: { action: data.action, mergedFactId: data.mergedFactId },
    });
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[brain/conflicts/:id/resolve] failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
