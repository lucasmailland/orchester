// apps/web/app/api/me/active-workspace/route.ts
//
// POST /api/me/active-workspace
//
// Atomic helper that the switcher uses instead of writing the cookie
// from the browser. Validates that the caller is a member of the slug
// before persisting; rejects otherwise to prevent a malicious client
// from setting an arbitrary cookie that the middleware will trust.
//
// This route lives under /api/me which is intentionally on the
// `EXCLUDE_RBAC` list in `scripts/audit-invariants.sh` — the lint guard
// expects routes that auth themselves (we do via requireAuth here) and
// the cookie write does not need a tenant context to begin with.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";

export const dynamic = "force-dynamic";

const Schema = z.object({ slug: z.string().regex(/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/) });

export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;

  const ws = await resolveBySlug(parsed.data.slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

  const m = await checkMembership(ctx.user.id, ws.id);
  if (!m) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  const res = NextResponse.json({ slug: parsed.data.slug });
  res.cookies.set("orch-active-workspace", parsed.data.slug, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: false, // intentionally readable from client for switcher hydration
    secure: process.env["NODE_ENV"] === "production",
  });
  return res;
}
