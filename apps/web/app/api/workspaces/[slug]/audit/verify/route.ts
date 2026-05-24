// apps/web/app/api/workspaces/[slug]/audit/verify/route.ts
//
// GET /api/workspaces/[slug]/audit/verify
//
// On-demand chain verification: walks the workspace's audit_log and
// returns the first row whose recomputed hash diverges from what's
// persisted (or `brokenAt: null` for an intact chain).
//
// Wired in addition to the daily `audit.verify_all_chains` cron so an
// admin can confirm integrity right after a sensitive op (member
// removal, ownership transfer, etc.).
import { NextResponse, type NextRequest } from "next/server";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { requireAuth } from "@/lib/auth-guards";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { verifyChain } from "@/lib/audit/verify";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }

  const m = await checkMembership(ctx.user.id, ws.id);
  if (!m) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  try {
    assertCan(m.role, "audit.read");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
    }
    throw e;
  }

  const result = await verifyChain(ws.id);
  return NextResponse.json(result);
}
