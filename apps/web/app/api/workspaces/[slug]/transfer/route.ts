// apps/web/app/api/workspaces/[slug]/transfer/route.ts
//
// POST /api/workspaces/[slug]/transfer
//
// Transfers workspace ownership to another member. Requires the current
// owner to re-prove with their password — irreversible action, defends
// against session hijack.
//
// Flow:
//   1. Caller MUST be the current owner.
//   2. Caller submits { newOwnerId, password }.
//   3. We re-verify password via better-auth (`signInEmail` with the
//      caller's own email — succeeds iff password matches).
//   4. New owner must already be a member; we promote them to owner +
//      demote the previous owner to admin.
//   5. Audit `workspace.transfer`. Invalidate membership cache for
//      both parties so the role change propagates immediately.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { resolveBySlug, invalidateCache } from "@/lib/tenant/resolve";
import { invalidateMembership, invalidateAllMembershipFor } from "@/lib/tenant/membership";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { requireAuth } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { appendAuditSync } from "@/lib/audit/log";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Schema = z.object({
  newOwnerId: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.ownerUserId !== ctx.user.id) {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const accessible = isAccessible(ws);
  if (!accessible.ok) {
    return NextResponse.json(
      { error: accessible.reason },
      { status: accessible.reason === "deleted" ? 410 : 423 }
    );
  }

  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;

  // Rate-limit per-(user,workspace): 5 attempts then refill at one
  // token every 180s (~20 attempts/hour). Critical because the next
  // step is a password compare — without a limiter we leak
  // brute-force capacity on the owner's credentials. Keying on
  // user+workspace stops one bad actor from blowing the bucket of
  // every workspace the victim owns.
  const rl = await rateLimit(`transfer:${ctx.user.id}:${ws.id}`, {
    capacity: 5,
    refillPerSec: 1 / 180,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) },
      }
    );
  }

  // Re-verify password via better-auth. If sign-in succeeds, password
  // is correct; we discard the resulting session — the existing one
  // stays. If it fails we treat as forbidden AND audit the denial so
  // forensic review can spot brute-force patterns even when the
  // limiter mostly absorbs them.
  try {
    await auth.api.signInEmail({
      body: { email: ctx.user.email, password: parsed.data.password },
    });
  } catch {
    // Use sync writer so audit lands before we 403; fire-and-forget
    // appendAudit would silently drop on SIGTERM mid-response.
    await appendAuditSync(ws.id, {
      action: "workspace.transfer_denied",
      actorUserId: ctx.user.id,
      actorKind: "user",
      targetType: "workspace",
      targetId: ws.id,
      meta: { reason: "password_invalid" },
    });
    return NextResponse.json({ error: "password_invalid" }, { status: 403 });
  }

  if (parsed.data.newOwnerId === ctx.user.id) {
    return NextResponse.json({ error: "same_owner" }, { status: 400 });
  }

  const db = getDb();
  // Verify the target is already a member.
  const targetMember = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, ws.id),
        eq(schema.workspaceMembers.userId, parsed.data.newOwnerId)
      )
    )
    .limit(1);
  if (!targetMember[0]) {
    return NextResponse.json({ error: "new_owner_not_a_member" }, { status: 422 });
  }

  // Perform the swap atomically so we never end up with two owners or
  // zero owners.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.workspaces)
      .set({ ownerUserId: parsed.data.newOwnerId, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, ws.id));
    await tx
      .update(schema.workspaceMembers)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, ws.id),
          eq(schema.workspaceMembers.userId, parsed.data.newOwnerId)
        )
      );
    await tx
      .update(schema.workspaceMembers)
      .set({ role: "admin" })
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, ws.id),
          eq(schema.workspaceMembers.userId, ctx.user.id)
        )
      );
  });

  invalidateCache(ws.id);
  invalidateMembership(ctx.user.id, ws.id);
  invalidateMembership(parsed.data.newOwnerId, ws.id);

  // Force a fresh login for the PREVIOUS owner. After transfer their
  // authority over this workspace dropped from owner→admin; if their
  // session was hijacked (the whole reason we required password
  // re-prove on the way in), the attacker still holds a session
  // token whose `activeWorkspaceId` may point at this workspace and
  // whose previously-cached membership says "owner". Deleting every
  // session row for them forces the next request to land on the
  // login page and pick the workspace fresh, where the resolver
  // sees the new role.
  //
  // We use a direct DELETE on the better-auth `session` table (no
  // public API for "revoke sessions belonging to an arbitrary user"
  // — `revokeUserSessions` revokes the CURRENT caller's sessions).
  // Cascade is irrelevant: sessions have no children, so a delete
  // is sufficient.
  //
  // Also wipe the previous owner's membership cache entirely (not
  // just this workspace) — they may have been impersonated across
  // peers; the next request from any pod should re-read every row.
  let sessionsRevoked = 0;
  let sessionRevocationError: string | null = null;
  try {
    const deleted = await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, ctx.user.id))
      .returning({ id: schema.sessions.id });
    sessionsRevoked = deleted.length;
    invalidateAllMembershipFor(ctx.user.id);
  } catch (e) {
    // Log but do NOT fail the transfer — ownership has already
    // changed in the DB and rolling back would leave the workspace
    // owner-less. Operators see this in the audit entry's
    // `sessionRevocationError` field below.
    sessionRevocationError = e instanceof Error ? e.message : String(e);
    const { safeLogError } = await import("@/lib/safe-log");
    safeLogError("[transfer] failed to revoke previous-owner sessions:", e);
  }

  // Use the SYNC writer so a SIGTERM between the role swap and the
  // audit write can't silently lose the entry. Both entries are
  // chained sequentially so the second `member.session_revoked`
  // inherits the chain hash from `workspace.transfer`.
  await appendAuditSync(ws.id, {
    action: "workspace.transfer",
    actorUserId: ctx.user.id,
    actorKind: "user",
    targetType: "workspace",
    targetId: ws.id,
    meta: {
      previousOwnerId: ctx.user.id,
      newOwnerId: parsed.data.newOwnerId,
      sessionsRevoked,
    },
  });

  // Separate audit entry so forensic review can grep on
  // member.session_revoked without trawling every transfer.
  // `sessionRevocationError` is null on success — present only when
  // the delete threw, so SOC can spot the partial-success case.
  await appendAuditSync(ws.id, {
    action: "member.session_revoked",
    actorUserId: ctx.user.id,
    actorKind: "system",
    targetType: "user",
    targetId: ctx.user.id,
    meta: {
      reason: "workspace.transfer",
      previousRole: "owner",
      newRole: "admin",
      sessionsRevoked,
      sessionRevocationError,
    },
  });

  return NextResponse.json({
    workspace: { ...ws, ownerUserId: parsed.data.newOwnerId },
  });
}
