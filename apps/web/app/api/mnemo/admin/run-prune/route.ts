// apps/web/app/api/mnemo/admin/run-prune/route.ts
//
// POST /api/mnemo/admin/run-prune — admin "run now" for the Mnemosyne
// v1.2 janitor prune pass, scoped to THIS workspace.
//
// Prune archives inactive, low-relevance, non-pinned facts (hit_count
// = 0, age > 90d, relevance < 0.1). Weekly cron at Sunday 03:30 UTC.
// Idempotent — re-runs find nothing to do.
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueue, JOB_MNEMO_PRUNE } from "@/lib/queue";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).loose();

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  const jobId = await enqueue(JOB_MNEMO_PRUNE, { workspaceId: ctx.workspace.id });

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.admin.run-prune",
    resource: "mnemo_cron",
    resourceId: JOB_MNEMO_PRUNE,
  });

  return NextResponse.json({ enqueued: true, jobId });
}
