// apps/web/app/api/mnemo/facts/[id]/forget/route.ts
//
// POST /api/mnemo/facts/[id]/forget — soft-delete a fact.
// Sets `status='forgotten'` so the row is preserved for audit but
// removed from recall (the recall layer filters on status='active').
// Use the matching `/restore` route to bring it back.
//
// Dispatches via `lib/mnemo/facts.forgetWorkspaceFact`, which calls
// the SDK's `forgetFact` — flips status to 'forgotten' AND closes
// the bitemporal interval (`valid_to = now()`) in a single
// server-side transaction.
//
// RBAC: editor+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { forgetWorkspaceFact } from "@/lib/mnemo/facts";

export const dynamic = "force-dynamic";

const forgetBodySchema = z.object({}).loose();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, forgetBodySchema);
  if (!parsed.ok) return parsed.response;

  const result = await forgetWorkspaceFact(ctx.workspace.id, id);
  if (!result.data) {
    const r = NextResponse.json({ error: "Not found" }, { status: 404 });
    r.headers.set("X-Mnemo-Mode", result.mode);
    return r;
  }
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.fact.forget",
    resource: "mnemo_fact",
    resourceId: result.data.id,
  });
  const r = NextResponse.json(result.data);
  r.headers.set("X-Mnemo-Mode", result.mode);
  return r;
}
