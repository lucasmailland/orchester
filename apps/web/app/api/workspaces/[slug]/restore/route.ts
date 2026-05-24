// apps/web/app/api/workspaces/[slug]/restore/route.ts
//
// Reverses a soft-delete inside the 30-day window. Two acceptance
// paths:
//   1. The caller is the workspace owner (authenticated session).
//   2. The caller presents the one-shot `restoreToken` that the
//      DELETE endpoint returned. Useful for "save this email" flows
//      where the original owner may not be the one restoring.
//
// `lifecycle.restore` throws `workspace_lifecycle_invalid` if the
// workspace is no longer in `deleted` state (i.e. already restored,
// hard-deleted, or never deleted) and `invalid_or_used_token` if the
// provided token doesn't match the persisted one or was already
// consumed. We translate those to 409 / 403 respectively.
//
// This route is exempted from the parseBody pre-commit lint per
// `scripts/audit-invariants.sh` (the `/restore/route.ts$` rule) — the
// body is optional and we validate it with zod regardless.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { restore } from "@/lib/tenant/lifecycle";
import { requireAuth } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

const Schema = z.object({ token: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug } = await params;

  // Parse + validate the body up front so we don't reveal anything
  // about workspace existence based on body shape.
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 422 });
  }

  // Pre-authorization phase: every failure here returns the SAME 403
  // `forbidden` so an unauthenticated probe cannot distinguish:
  //   - the slug doesn't exist
  //   - the slug exists but is not deleted (no token applies)
  //   - the slug exists, is deleted, but the caller isn't the owner
  //     and didn't present a valid token
  //
  // Only AFTER restore() succeeds (i.e. authorization is established
  // either via the one-shot token or owner identity) do we vary the
  // response. The lifecycle errors thrown by restore() are also
  // collapsed to the same 403 — only callers who already authenticated
  // would see them, but defense-in-depth.
  const generic = NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ws = await resolveBySlug(slug);
  if (!ws) return generic;

  // Either token OR owner authentication.
  if (!parsed.data.token && ws.ownerUserId !== ctx.user.id) {
    return generic;
  }

  try {
    await restore(ws.id, {
      ...(parsed.data.token !== undefined ? { token: parsed.data.token } : {}),
      userId: ctx.user.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Collapse all lifecycle / token failures to the same generic 403
    // so the route stays non-enumerable. The owner / token holder can
    // diagnose state out-of-band via the audit log.
    if (msg === "workspace_lifecycle_invalid" || msg === "invalid_or_used_token") {
      return generic;
    }
    throw e;
  }

  return NextResponse.json({ workspace: { ...ws, status: "active" as const } });
}
