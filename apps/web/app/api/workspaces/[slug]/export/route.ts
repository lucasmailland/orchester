// apps/web/app/api/workspaces/[slug]/export/route.ts
//
// POST /api/workspaces/[slug]/export — kicks off a GDPR-style export
// for the entire workspace. Owner-only because the artefact contains
// every member's PII.
//
// We persist the job row first (state `pending`) so a duplicate
// request can be denied via singleton key, then enqueue a pg-boss job
// the worker will pick up. The response is 202 + the jobId so the UI
// can poll `/api/workspaces/[slug]/export/[jobId]`.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { requireAuth } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueue, JOB_GDPR_EXPORT } from "@/lib/queue";
import { appendAudit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

const Schema = z.object({}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }
  if (ws.ownerUserId !== ctx.user.id) {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  // Body is optional; validate strictly so unexpected fields fail loud.
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;

  const db = getDb();
  const jobId = `exp_${createId()}`;
  await db.insert(schema.gdprExportJobs).values({
    id: jobId,
    workspaceId: ws.id,
    requestedByUserId: ctx.user.id,
    state: "pending",
    progress: 0,
  });

  // Enqueue worker; singleton-key prevents two simultaneous exports for
  // the same workspace from racing on the same artefact path.
  await enqueue(JOB_GDPR_EXPORT, { jobId }, { singletonKey: `gdpr:${ws.id}` });

  appendAudit(ws.id, {
    action: "workspace.export",
    actorUserId: ctx.user.id,
    actorKind: "user",
    targetType: "workspace",
    targetId: ws.id,
    meta: { jobId },
  });

  return NextResponse.json(
    { jobId, state: "pending", estimatedDurationSeconds: 180 },
    { status: 202 }
  );
}
