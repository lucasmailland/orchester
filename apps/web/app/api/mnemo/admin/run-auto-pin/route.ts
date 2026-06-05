// apps/web/app/api/mnemo/admin/run-auto-pin/route.ts
//
// POST /api/mnemo/admin/run-auto-pin — admin "run now" for the
// Mnemosyne v1.3 auto-pin cron, scoped to THIS workspace.
//
// Evaluates the pure rule set in `decideAutoPin` (preferences/identity
// + age > 7d + hit_count >= 3, contradiction-resolved overrides,
// pinned-by-rule-set) against active facts and pins matches, stamping
// metadata.auto_pinned = { rule, at }. Honours the user-override flag
// (metadata.auto_pinned_overridden = true skips the row).
//
// Daily cron at 04:30 UTC, staggered after review-sweep.
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueue, JOB_MNEMO_AUTO_PIN } from "@/lib/queue";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).loose();

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  const jobId = await enqueue(JOB_MNEMO_AUTO_PIN, { workspaceId: ctx.workspace.id });

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.admin.run-auto-pin",
    resource: "mnemo_cron",
    resourceId: JOB_MNEMO_AUTO_PIN,
  });

  return NextResponse.json({ enqueued: true, jobId });
}
