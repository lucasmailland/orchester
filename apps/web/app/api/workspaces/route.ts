import { NextResponse, type NextRequest } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { requireAuth } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { appendAudit } from "@/lib/audit/log";

/**
 * POST /api/workspaces — create a new workspace owned by the current
 * user.
 *
 * RBAC: this is the only mutating route that uses
 * `workspaceOptional: true` — a user creating their first workspace by
 * definition has no active workspace yet, so we authenticate the
 * session but skip the workspace-role check. Role checks for editing
 * an existing workspace happen on PATCH/DELETE routes per the
 * standard pattern.
 *
 * Two-row write (workspace + owner membership) is done outside a
 * transaction because the check constraint
 * `workspace_owner_must_be_member` is column-level (NOT NULL on
 * owner_user_id — see migration 0001), so ordering doesn't matter for
 * correctness as long as both rows land.
 *
 * Audit entry is fire-and-forget via the async `appendAudit` wrapper;
 * the response doesn't wait for it so the user gets the new workspace
 * URL right away.
 */
export const dynamic = "force-dynamic";

const Schema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/),
  timezone: z.string().default("UTC"),
});

export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;

  const db = getDb();

  // Slug-availability check. Race with another concurrent POST is
  // possible — Postgres' unique index on workspace.slug catches that
  // and the insert below throws; we translate to the same 409.
  const existing = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, parsed.data.slug))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: "workspace_slug_taken" }, { status: 409 });
  }

  const wsId = `ws_${createId()}`;
  try {
    await db.insert(schema.workspaces).values({
      id: wsId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      timezone: parsed.data.timezone,
      status: "active",
      ownerUserId: ctx.user.id,
    });
    await db.insert(schema.workspaceMembers).values({
      id: createId(),
      workspaceId: wsId,
      userId: ctx.user.id,
      role: "owner",
    });
  } catch (e) {
    // Catch the unique-violation race described above.
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate key|workspace_slug_key|unique/i.test(msg)) {
      return NextResponse.json({ error: "workspace_slug_taken" }, { status: 409 });
    }
    throw e;
  }

  appendAudit(wsId, {
    action: "workspace.create",
    actorUserId: ctx.user.id,
    actorKind: "user",
    targetType: "workspace",
    targetId: wsId,
    meta: { name: parsed.data.name, slug: parsed.data.slug },
  });

  const res = NextResponse.json(
    {
      workspace: {
        id: wsId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        status: "active",
        role: "owner",
      },
    },
    { status: 201 }
  );
  // Activate the new workspace immediately so the next navigation
  // resolves to it.
  res.cookies.set("orch-active-workspace", parsed.data.slug, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });
  return res;
}
