// apps/web/app/api/mnemo/admin/run-consolidation/route.ts
//
// POST /api/mnemo/admin/run-consolidation — admin "run now" for the
// Mnemosyne v1.4 REM-style consolidation cron, scoped to THIS
// workspace.
//
// The weekly cron (Sunday 02:00 UTC, BEFORE the janitor at 03:00)
// clusters related facts per workspace (same subject + kind + cosine
// >= 0.75, size >= 4), uses the cheap-tier LLM to write a one-sentence
// summary, and stamps `derived_from` edges from members to the
// summary. Originals stay active; the summary becomes the canonical
// recall hit.
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueue, JOB_MNEMO_CONSOLIDATION } from "@/lib/queue";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).loose();

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  const jobId = await enqueue(JOB_MNEMO_CONSOLIDATION, { workspaceId: ctx.workspace.id });

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.admin.run-consolidation",
    resource: "mnemo_cron",
    resourceId: JOB_MNEMO_CONSOLIDATION,
  });

  return NextResponse.json({ enqueued: true, jobId });
}
