import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { invalidateMembership } from "@/lib/tenant/membership";

/**
 * GET /api/workspace-members
 * Lista los miembros del workspace activo del caller con sus datos de auth
 * (name, email, image) y el role.
 *
 * PATCH /api/workspace-members?userId=...&role=...
 * Cambia el role de un miembro. Sólo owner/admin. No permite degradar al
 * último owner ni autoasignarse owner.
 *
 * DELETE /api/workspace-members?userId=...
 * Saca a un miembro del workspace. No se puede borrar al owner.
 */
export async function GET() {
  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, tx }) => {
      const rows = await tx
        .select({
          userId: schema.workspaceMembers.userId,
          role: schema.workspaceMembers.role,
          joinedAt: schema.workspaceMembers.createdAt,
          name: schema.users.name,
          email: schema.users.email,
          image: schema.users.image,
        })
        .from(schema.workspaceMembers)
        .innerJoin(schema.users, eq(schema.workspaceMembers.userId, schema.users.id))
        .where(eq(schema.workspaceMembers.workspaceId, ctx.workspace.id))
        .orderBy(schema.workspaceMembers.createdAt);

      return { members: rows, callerRole: ctx.role };
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

const VALID_ROLES = new Set(["owner", "admin", "editor", "viewer"]);

export async function PATCH(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const role = url.searchParams.get("role");
  if (!userId || !role || !VALID_ROLES.has(role)) {
    return NextResponse.json(
      { error: "userId + role required (role one of owner/admin/editor/viewer)" },
      { status: 400 }
    );
  }

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, user, tx }) => {
      // SEC-11: self-IDOR guard — admins cannot modify their own membership.
      if (userId === user.id) {
        return { _err: "Cannot modify your own membership", _status: 403 };
      }

      // Solo el owner puede crear otros owners.
      if (role === "owner" && ctx.role !== "owner") {
        return { _err: "Only owner can promote to owner", _status: 403 };
      }

      // Si la modificación degrada un owner, asegurate de que quede al menos uno.
      const target = (
        await tx
          .select()
          .from(schema.workspaceMembers)
          .where(
            and(
              eq(schema.workspaceMembers.workspaceId, ctx.workspace.id),
              eq(schema.workspaceMembers.userId, userId)
            )
          )
          .limit(1)
      )[0];
      if (!target) return { _err: "Member not found", _status: 404 };

      if (target.role === "owner" && role !== "owner") {
        const owners = await tx
          .select({ id: schema.workspaceMembers.id })
          .from(schema.workspaceMembers)
          .where(
            and(
              eq(schema.workspaceMembers.workspaceId, ctx.workspace.id),
              eq(schema.workspaceMembers.role, "owner")
            )
          );
        if (owners.length <= 1) {
          return { _err: "Workspace must keep at least one owner", _status: 400 };
        }
      }

      await tx
        .update(schema.workspaceMembers)
        .set({ role: role as "owner" | "admin" | "editor" | "viewer" })
        .where(eq(schema.workspaceMembers.id, target.id));

      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "member.role_change",
        resource: "workspace_member",
        resourceId: target.id,
        before: { role: target.role },
        after: { role },
      });

      return { ok: true, invalidate: { userId, workspaceId: ctx.workspace.id } };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });

  // Drop the cached (userId, workspaceId) membership row so the next
  // role-gated check (in this or any peer worker) re-reads the row
  // instead of trusting the stale role we just overwrote. Without this
  // the new role only takes effect after the 60s TTL — long enough for
  // a demoted user to keep writing for a minute.
  invalidateMembership(result.invalidate.userId, result.invalidate.workspaceId);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, user, tx }) => {
      // SEC-11: self-IDOR guard — admins cannot remove themselves.
      if (userId === user.id) {
        return { _err: "Cannot modify your own membership", _status: 403 };
      }

      const target = (
        await tx
          .select()
          .from(schema.workspaceMembers)
          .where(
            and(
              eq(schema.workspaceMembers.workspaceId, ctx.workspace.id),
              eq(schema.workspaceMembers.userId, userId)
            )
          )
          .limit(1)
      )[0];
      if (!target) return { _err: "Member not found", _status: 404 };
      if (target.role === "owner") {
        return { _err: "Cannot remove owner", _status: 400 };
      }

      await tx.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.id, target.id));

      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "member.remove",
        resource: "workspace_member",
        resourceId: target.id,
        before: { userId: target.userId, role: target.role },
      });

      return { ok: true, invalidate: { userId, workspaceId: ctx.workspace.id } };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });

  // Drop the membership cache entry — without this the removed user
  // could still pass checkMembership() for up to 60s and keep writing
  // until the TTL expires.
  invalidateMembership(result.invalidate.userId, result.invalidate.workspaceId);

  return NextResponse.json({ ok: true });
}
