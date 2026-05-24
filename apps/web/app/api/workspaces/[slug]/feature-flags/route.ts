// apps/web/app/api/workspaces/[slug]/feature-flags/route.ts
//
// GET /api/workspaces/[slug]/feature-flags
//
// Lists every per-workspace feature flag row (enabled + disabled). Used
// by the FeatureFlagAdminPanel UI. Admin/owner only — flags can gate
// risky features and listing them reveals product surface area.
import { NextResponse, type NextRequest } from "next/server";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { requireAuth } from "@/lib/auth-guards";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { listFlags } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

  const m = await checkMembership(ctx.user.id, ws.id);
  if (!m) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  try {
    assertCan(m.role, "settings.write");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
    }
    throw e;
  }

  const flags = await listFlags(ws.id);
  return NextResponse.json({ flags });
}
