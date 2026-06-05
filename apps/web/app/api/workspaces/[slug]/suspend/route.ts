// apps/web/app/api/workspaces/[slug]/suspend/route.ts
//
// POST   /api/workspaces/[slug]/suspend  → suspend a workspace.
// DELETE /api/workspaces/[slug]/suspend  → unsuspend a workspace.
//
// System-admin only — the workspace-scoped owner role is intentionally
// NOT enough here. A workspace owner suspending their own workspace
// would be self-DoS with no operator visibility; conversely a
// compromised owner could unsuspend a workspace an operator suspended
// for ToS reasons. Both directions of the lifecycle live behind
// `assertSystemAdmin` so the audit trail and the authority line up.
//
// Returns:
//   200 { workspace: {...} } on success
//   401 unauthenticated
//   403 forbidden (not on ADMIN_EMAILS)
//   404 workspace_not_found
//   409 workspace_lifecycle_invalid (already in target state / deleted)
//   422 missing required `reason` on POST
//
// Both verbs go through `suspend` / `unsuspend` in lib/tenant/lifecycle,
// which already:
//   - asserts the current status (active→suspended / suspended→active)
//   - invalidates the resolver cache so the next request sees the new
//     status without waiting for TTL
//   - appends `workspace.suspend` / `workspace.unsuspend` audit entries
//
// We don't re-audit here — duplicating would chain two entries for one
// operator action.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { suspend, unsuspend } from "@/lib/tenant/lifecycle";
import { assertSystemAdmin, SystemAdminRequiredError } from "@/lib/rbac";
import { appendAuditSync } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

const SuspendSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  try {
    assertSystemAdmin(ctx.user.email);
  } catch (e) {
    if (e instanceof SystemAdminRequiredError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw e;
  }

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }

  const parsed = await parseBody(req, SuspendSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await suspend(ws.id, { reason: parsed.data.reason, userId: ctx.user.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "workspace_lifecycle_invalid") {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg === "workspace_not_found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    throw e;
  }

  return NextResponse.json({
    workspace: { ...ws, status: "suspended" as const },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  try {
    assertSystemAdmin(ctx.user.email);
  } catch (e) {
    if (e instanceof SystemAdminRequiredError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw e;
  }

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }

  // Trace the unsuspend attempt BEFORE the lifecycle call. If the
  // workspace is already active, `unsuspend` throws
  // workspace_lifecycle_invalid and the operator has no signal in the
  // audit chain that anything was attempted — SOC would have nothing
  // to grep for. We log the attempt up-front; on success the
  // `workspace.unsuspend` entry inside lifecycle.ts confirms it.
  if (ws.status === "active") {
    await appendAuditSync(ws.id, {
      action: "workspace.unsuspend_attempted",
      actorUserId: ctx.user.id,
      actorKind: "user",
      targetType: "workspace",
      targetId: ws.id,
      meta: { result: "already_active" },
    });
  }

  try {
    await unsuspend(ws.id, { userId: ctx.user.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "workspace_lifecycle_invalid") {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg === "workspace_not_found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    throw e;
  }

  return NextResponse.json({
    workspace: { ...ws, status: "active" as const },
  });
}
