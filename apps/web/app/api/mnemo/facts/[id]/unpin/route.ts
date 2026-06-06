// apps/web/app/api/mnemo/facts/[id]/unpin/route.ts
//
// POST /api/mnemo/facts/[id]/unpin — set pinned=false on a fact.
//
// If the fact had been auto-pinned (metadata.auto_pinned is set),
// this unpin stamps `metadata.auto_pinned_overridden = true` so the
// daily auto-pin cron won't re-pin it. The user's choice wins.
//
// Dispatches via `lib/mnemo/facts.unpinWorkspaceFact`: reads metadata
// via the SDK, conditionally stamps the override flag, then PATCHes
// back through the @mnemosyne/server SDK.
//
// RBAC: editor+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { unpinWorkspaceFact } from "@/lib/mnemo/facts";

export const dynamic = "force-dynamic";

const unpinBodySchema = z.object({}).loose();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, unpinBodySchema);
  if (!parsed.ok) return parsed.response;

  const result = await unpinWorkspaceFact(ctx.workspace.id, id);
  if (!result.data) {
    const r = NextResponse.json({ error: "Not found" }, { status: 404 });
    r.headers.set("X-Mnemo-Mode", result.mode);
    return r;
  }
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.fact.unpin",
    resource: "mnemo_fact",
    resourceId: result.data.id,
  });
  const r = NextResponse.json(result.data);
  r.headers.set("X-Mnemo-Mode", result.mode);
  return r;
}
