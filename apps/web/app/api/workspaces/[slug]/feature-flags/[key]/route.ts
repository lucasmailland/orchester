// apps/web/app/api/workspaces/[slug]/feature-flags/[key]/route.ts
//
// PUT /api/workspaces/[slug]/feature-flags/[key]
//
// Toggles a single per-workspace feature flag. Audits as
// `featureflag.set` so admin actions are forensically traceable.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { requireAuth } from "@/lib/auth-guards";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { setFlag } from "@/lib/feature-flags";
import { parseBody } from "@/lib/validation";
import { appendAudit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

const Schema = z.object({ enabled: z.boolean() });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; key: string }> }
) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug, key } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

  const m = await checkMembership(ctx.user.id, ws.id);
  if (!m) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  const accessible = isAccessible(ws);
  if (!accessible.ok) {
    return NextResponse.json(
      { error: accessible.reason },
      { status: accessible.reason === "deleted" ? 410 : 423 }
    );
  }

  try {
    assertCan(m.role, "settings.write");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
    }
    throw e;
  }

  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;

  await setFlag(ws.id, key, parsed.data.enabled, { userId: ctx.user.id });

  appendAudit(ws.id, {
    action: "featureflag.set",
    actorUserId: ctx.user.id,
    actorKind: "user",
    targetType: "feature_flag",
    targetId: key,
    meta: { enabled: parsed.data.enabled },
  });

  return NextResponse.json({ flagKey: key, enabled: parsed.data.enabled });
}
