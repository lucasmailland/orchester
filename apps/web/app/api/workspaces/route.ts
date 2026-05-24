import { NextResponse, type NextRequest } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
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
 * The two-row write (workspace + owner membership) MUST be atomic —
 * if the membership insert fails after the workspace insert we end
 * up with an orphan workspace nobody can access and no way to clean
 * up via the normal RBAC paths. Wrap both in a single transaction.
 *
 * We also set the tenant GUC inside the transaction so the inserts
 * pass any future FORCE RLS on `workspace` / `workspace_member`
 * (today only some related tables are FORCED; setting the GUC is
 * cheap and future-proofs the route).
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
    await db.transaction(async (tx) => {
      // SET LOCAL so the GUC reverts on commit/rollback and cannot
      // leak across the pooled connection. Required for the inserts
      // to pass FORCE RLS on tables that key on `current_workspace_id()`.
      await tx.execute(sql`SELECT set_config('app.workspace_id', ${wsId}, true)`);
      await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
      await tx.insert(schema.workspaces).values({
        id: wsId,
        name: parsed.data.name,
        slug: parsed.data.slug,
        timezone: parsed.data.timezone,
        status: "active",
        ownerUserId: ctx.user.id,
      });
      await tx.insert(schema.workspaceMembers).values({
        id: createId(),
        workspaceId: wsId,
        userId: ctx.user.id,
        role: "owner",
      });
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
  // resolves to it. Mark `secure` in production so the cookie is
  // never sent over plaintext HTTP (matches the other workspace-
  // related cookie writes).
  res.cookies.set("orch-active-workspace", parsed.data.slug, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
  });
  return res;
}
