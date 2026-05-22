import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";

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
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const rows = await db
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
    .where(eq(schema.workspaceMembers.workspaceId, ws.workspace.id))
    .orderBy(schema.workspaceMembers.createdAt);

  return NextResponse.json({ members: rows, callerRole: ws.role });
}

const VALID_ROLES = new Set(["owner", "admin", "editor", "viewer"]);

export async function PATCH(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const role = url.searchParams.get("role");
  if (!userId || !role || !VALID_ROLES.has(role)) {
    return NextResponse.json(
      { error: "userId + role required (role one of owner/admin/editor/viewer)" },
      { status: 400 }
    );
  }

  // Solo el owner puede crear otros owners.
  if (role === "owner" && ctx.role !== "owner") {
    return NextResponse.json({ error: "Only owner can promote to owner" }, { status: 403 });
  }

  const db = getDb();

  // Si la modificación degrada un owner, asegurate de que quede al menos uno.
  const target = (
    await db
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
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  if (target.role === "owner" && role !== "owner") {
    const owners = await db
      .select({ id: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, ctx.workspace.id),
          eq(schema.workspaceMembers.role, "owner")
        )
      );
    if (owners.length <= 1) {
      return NextResponse.json({ error: "Workspace must keep at least one owner" }, { status: 400 });
    }
  }

  await db
    .update(schema.workspaceMembers)
    .set({ role: role as "owner" | "admin" | "editor" | "viewer" })
    .where(eq(schema.workspaceMembers.id, target.id));

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "member.role_change",
    resource: "workspace_member",
    resourceId: target.id,
    before: { role: target.role },
    after: { role },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const db = getDb();
  const target = (
    await db
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
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.role === "owner") {
    return NextResponse.json({ error: "Cannot remove owner" }, { status: 400 });
  }

  await db
    .delete(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.id, target.id));

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "member.remove",
    resource: "workspace_member",
    resourceId: target.id,
    before: { userId: target.userId, role: target.role },
  });

  return NextResponse.json({ ok: true });
}
