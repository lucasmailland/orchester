// POST /api/workspaces/[slug]/brain/decisions/[id]/supersede  — editor+ (brain.write)
// Body: { supersededById: string }  — the newer decision that replaces [id].
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { supersedeWorkspaceDecision } from "@/lib/mnemo/decisions";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ supersededById: z.string().min(1) });

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

  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.supersededById === id) {
    return NextResponse.json({ error: "cannot_supersede_self" }, { status: 400 });
  }

  try {
    const { mode, data, edgeCreated } = await supersedeWorkspaceDecision(
      ctx.workspace.id,
      id,
      parsed.data.supersededById,
      ctx.user.id
    );
    if (!data) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: { "X-Mnemo-Mode": mode } }
      );
    }
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "mnemo.decision.supersede",
      resource: "mnemo_decision",
      resourceId: id,
      after: { supersededById: parsed.data.supersededById, edgeCreated },
    });
    return NextResponse.json({ ...data, edgeCreated }, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[brain/decisions/:id/supersede] failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
