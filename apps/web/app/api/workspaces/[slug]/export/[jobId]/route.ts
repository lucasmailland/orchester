// apps/web/app/api/workspaces/[slug]/export/[jobId]/route.ts
//
// GET /api/workspaces/[slug]/export/[jobId]
//
// Status polling endpoint for an in-flight (or completed) GDPR export
// job. Consumed by the UI bundle that ships in the next phase — the
// component renders a progress bar from `progress` and surfaces the
// signed URL once `state === "completed"`.
//
// Authorization:
//   - The caller must be authenticated AND a member of the workspace
//     (any role — even viewers can poll a job they kicked off).
//   - The job must belong to the workspace slug in the path (we treat
//     the slug → workspaceId resolution as canonical).
//   - The caller must be the original requester OR the workspace
//     owner. We do NOT let arbitrary admins peek at another member's
//     export artefact — the signed URL is sensitive.
//
// Sanitisation:
//   - `error` is returned as-is when state="failed" (the worker already
//     redacts secrets via safeLogError before persisting) but we drop
//     `storageKey` and internal fields that don't help the client.
//   - `bytesTotal` is bigint; we serialise it as a string so JSON.stringify
//     doesn't throw.
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { requireAuth } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; jobId: string }> }
) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug, jobId } = await params;

  const ws = await resolveBySlug(slug);
  if (!ws) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }

  // Membership precedes the lifecycle check so a stranger doesn't get
  // a 423/410 signal about whether the workspace exists.
  const m = await checkMembership(ctx.user.id, ws.id);
  if (!m) {
    return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  }

  const accessible = isAccessible(ws);
  if (!accessible.ok) {
    return NextResponse.json(
      { error: accessible.reason },
      { status: accessible.reason === "deleted" ? 410 : 423 }
    );
  }

  const db = getDb();
  // Compose (id, workspaceId) into the WHERE so we never leak a job
  // belonging to a different workspace via id-guessing — the slug in
  // the URL is the only authoritative tenant marker.
  const rows = await db
    .select()
    .from(schema.gdprExportJobs)
    .where(and(eq(schema.gdprExportJobs.id, jobId), eq(schema.gdprExportJobs.workspaceId, ws.id)))
    .limit(1);
  const job = rows[0];
  if (!job) {
    return NextResponse.json({ error: "job_not_found" }, { status: 404 });
  }

  // Per-export ACL: the signed URL is sensitive, so only the original
  // requester OR the workspace owner can read job state. Admins are
  // intentionally excluded — they can audit via the audit log.
  const isRequester = job.requestedByUserId === ctx.user.id;
  const isOwner = ws.ownerUserId === ctx.user.id;
  if (!isRequester && !isOwner) {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  // Serialise the row. bigint → string for JSON; drop noisy internal
  // fields the UI doesn't need.
  const { storageKey: _storageKey, checkpoint: _checkpoint, bytesTotal, ...rest } = job;

  return NextResponse.json({
    ...rest,
    bytesTotal: bytesTotal === null || bytesTotal === undefined ? null : bytesTotal.toString(),
  });
}
