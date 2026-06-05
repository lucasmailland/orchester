// apps/web/app/api/mnemo/facts/[id]/restore/route.ts
//
// POST /api/mnemo/facts/[id]/restore — reverse of /forget.
// Sets `status='active'` so the fact rejoins the recall pool.
//
// As of the service-extraction Phase 2 (tramo 3), the handler
// delegates to `restoreWorkspaceFact()` which picks the data source
// at runtime (service vs library). `X-Mnemo-Mode` surfaces which
// path served the request.
//
// This path is *param-only* by design (no body) — the audit-invariants
// script exempts `/restore/route.ts$` from the parseBody check.
// We still gate with `requireAuth` (RBAC: editor+).
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { restoreWorkspaceFact } from "@/lib/mnemo/facts";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  try {
    const { mode, data } = await restoreWorkspaceFact(ctx.workspace.id, id);
    if (!data) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "X-Mnemo-Mode": mode } }
      );
    }
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "mnemo.fact.restore",
      resource: "mnemo_fact",
      resourceId: data.id,
    });
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[mnemo/facts/:id/restore] failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
