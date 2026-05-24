// apps/web/app/api/workspaces/[slug]/route.ts
//
// Slug-keyed workspace endpoint. Phase E replaces the legacy id-keyed
// route for everything except internal lookups: the URL the UI knows is
// `/[locale]/[workspaceSlug]/…`, so REST should mirror that.
//
// GET    → fetch the workspace + caller role (membership-gated).
// PATCH  → update name / timezone (admin+) or slug (owner only).
//          Audit `workspace.update`.
// DELETE → soft-delete (owner only) with `confirm_slug` to prevent
//          fat-finger nuking. Returns a one-shot restore token plus the
//          deadline (30 days) so the UI can show "save this token".
//
// Auth strategy: `requireAuth({ workspaceOptional: true })` for session
// validation (satisfies the RBAC lint), then `resolveBySlug` +
// `checkMembership` to bind to the specific slug from the URL — the
// caller's active workspace may be a *different* one. The owner-only
// branch on DELETE compares `ws.ownerUserId` directly.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { resolveBySlug, invalidateCache } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { softDelete } from "@/lib/tenant/lifecycle";
import { appendAudit } from "@/lib/audit/log";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { requireAuth } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

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
  if (!m) {
    return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  }

  return NextResponse.json({
    workspace: {
      id: ws.id,
      slug: ws.slug,
      name: ws.name,
      status: ws.status,
      timezone: ws.timezone,
      role: m.role,
    },
  });
}

const PatchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  timezone: z.string().optional(),
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/)
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }

  const m = await checkMembership(ctx.user.id, ws.id);
  if (!m) {
    return NextResponse.json({ error: "not_a_member" }, { status: 403 });
  }

  try {
    assertCan(m.role, "settings.write");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
    }
    throw e;
  }

  const parsed = await parseBody(req, PatchSchema);
  if (!parsed.ok) return parsed.response;

  // Slug change is owner-only — it rotates URLs everywhere.
  if (parsed.data.slug && parsed.data.slug !== ws.slug && m.role !== "owner") {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  // Validate timezone via the Intl API (Node 22 supports this natively).
  if (parsed.data.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone }).format();
    } catch {
      return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
    }
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name) set["name"] = parsed.data.name.trim();
  if (parsed.data.timezone) set["timezone"] = parsed.data.timezone;
  if (parsed.data.slug && parsed.data.slug !== ws.slug) set["slug"] = parsed.data.slug;

  const db = getDb();
  try {
    await db.update(schema.workspaces).set(set).where(eq(schema.workspaces.id, ws.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate key|workspace_slug_key|unique/i.test(msg)) {
      return NextResponse.json({ error: "workspace_slug_taken" }, { status: 409 });
    }
    throw e;
  }

  invalidateCache(ws.id);
  invalidateCache(ws.slug);

  appendAudit(ws.id, {
    action: "workspace.update",
    actorUserId: ctx.user.id,
    actorKind: "user",
    targetType: "workspace",
    targetId: ws.id,
    meta: {
      changes: Object.keys(set).filter((k) => k !== "updatedAt"),
    },
  });

  return NextResponse.json({
    workspace: { ...ws, ...set },
  });
}

const DeleteSchema = z.object({
  reason: z.string().optional(),
  confirm_slug: z.string(),
});

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
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

  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.confirm_slug !== ws.slug) {
    return NextResponse.json(
      {
        error: "validation_failed",
        fields: { confirm_slug: "does not match" },
      },
      { status: 422 }
    );
  }

  const { restoreToken, restoreUntil } = await softDelete(ws.id, {
    userId: ctx.user.id,
    ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
  });

  return NextResponse.json({
    workspace: { ...ws, status: "deleted" as const },
    restoreToken,
    restoreUntil: restoreUntil.toISOString(),
  });
}
