// apps/web/app/api/mnemo/facts/[id]/pin/route.ts
//
// POST /api/mnemo/facts/[id]/pin — set pinned=true on a fact.
//
// Body is empty (the action is fully encoded in the URL). We still
// parse it through zod so the audit-invariants script's parseBody
// check is satisfied.
//
// If the fact carries `metadata.auto_pinned_overridden = true` from
// a previous user unpin, this manual pin clears the override flag
// because the user has now explicitly chosen "pinned" again. The
// auto-pin cron is free to re-affirm later if its rules still match.
//
// Dispatches via `lib/mnemo/facts.pinWorkspaceFact`, which issues a
// GET (read current metadata) + PATCH (write pinned + computed
// metadata) through the @mnemosyne/server SDK.
//
// RBAC: editor+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { pinWorkspaceFact } from "@/lib/mnemo/facts";

export const dynamic = "force-dynamic";

const pinBodySchema = z.object({}).loose();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, pinBodySchema);
  if (!parsed.ok) return parsed.response;

  const result = await pinWorkspaceFact(ctx.workspace.id, id);
  if (!result.data) {
    const r = NextResponse.json({ error: "Not found" }, { status: 404 });
    r.headers.set("X-Mnemo-Mode", result.mode);
    return r;
  }
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.fact.pin",
    resource: "mnemo_fact",
    resourceId: result.data.id,
  });
  const r = NextResponse.json(result.data);
  r.headers.set("X-Mnemo-Mode", result.mode);
  return r;
}
