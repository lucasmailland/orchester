import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";
import { parseBody } from "@/lib/validation";
import { getStorage } from "@/lib/storage";
import { safeLogError } from "@/lib/safe-log";

const updateWorkspaceSchema = z.object({
  name: z.string().optional(),
  timezone: z.string().optional(),
});

/**
 * Endpoints del workspace. Validamos que el caller sea miembro Y que su rol
 * tenga el permiso necesario para cada acción.
 *
 *   GET    /api/workspaces/[id]            → lee info + role del caller
 *   PATCH  /api/workspaces/[id]            → name, timezone (admin/owner)
 *   DELETE /api/workspaces/[id]?slug=...   → hard delete (sólo owner)
 */

type Role = "owner" | "admin" | "editor" | "viewer";

async function loadMembership(workspaceId: string, userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function loadWorkspace(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

function canEdit(role: Role): boolean {
  return role === "owner" || role === "admin";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const membership = await loadMembership(id, session.user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ws = await loadWorkspace(id);
  if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ...ws, role: membership.role });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const membership = await loadMembership(id, session.user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canEdit(membership.role as Role)) {
    return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
  }

  const parsed = await parseBody(req, updateWorkspaceSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) {
    if (body.name.trim().length > 80) {
      return NextResponse.json({ error: "name too long (max 80)" }, { status: 400 });
    }
    set["name"] = body.name.trim();
  }
  if (typeof body.timezone === "string" && body.timezone.trim()) {
    // Validá vs Intl.supportedValuesOf si está disponible (Node 22 sí lo tiene).
    try {
      // Throws RangeError si la TZ es inválida.
      new Intl.DateTimeFormat("en-US", { timeZone: body.timezone }).format();
      set["timezone"] = body.timezone;
    } catch {
      return NextResponse.json({ error: "Invalid IANA timezone" }, { status: 400 });
    }
  }

  if (Object.keys(set).length === 1) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const db = getDb();
  const before = await loadWorkspace(id);
  const updated = await db
    .update(schema.workspaces)
    .set(set)
    .where(eq(schema.workspaces.id, id))
    .returning();
  await logAudit({
    workspaceId: id,
    userId: session.user.id,
    action: "workspace.update",
    resource: "workspace",
    resourceId: id,
    before: before ? { name: before.name, timezone: before.timezone } : undefined,
    after: { name: updated[0]?.name, timezone: updated[0]?.timezone },
  });
  return NextResponse.json({ ok: true, workspace: updated[0] ?? null });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const membership = await loadMembership(id, session.user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (membership.role !== "owner") {
    return NextResponse.json({ error: "Only owner can delete" }, { status: 403 });
  }

  // Confirmación: el caller debe enviar el slug en el query string para que un
  // click accidental no borre todo.
  const url = new URL(req.url);
  const confirmSlug = url.searchParams.get("slug");
  const ws = await loadWorkspace(id);
  if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (confirmSlug !== ws.slug) {
    return NextResponse.json(
      { error: "Confirmation slug mismatch", expected: ws.slug },
      { status: 400 }
    );
  }

  const db = getDb();
  // Loguear ANTES del delete — el cascade borraría también los audit_log.
  // Por eso el log se persiste al user_id sin workspace_id (workspaceId
  // queda apuntando a un ws que ya no existe; lo dejamos para forensics).
  await logAudit({
    workspaceId: id,
    userId: session.user.id,
    action: "workspace.delete",
    resource: "workspace",
    resourceId: id,
    before: { name: ws.name, slug: ws.slug },
  });
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  // Cascade en schema borra members, agents, conversations, etc.

  // M4-1: el cascade de la DB NO toca el object storage. Borramos todo lo
  // subido bajo este workspace (KB docs, imágenes/audio generados, etc.).
  // Las keys se generan con makeKey() como `${workspaceId}/<prefix>/...`,
  // así que el prefix del workspace es `${id}/`. Resiliente: un fallo de
  // storage no debe bloquear el delete del workspace (ya hecho arriba).
  try {
    const deleted = await getStorage().deleteByPrefix(`${id}/`);
    if (deleted > 0) {
      console.log(`[workspaces] deleted ${deleted} storage object(s) for ws=${id}`);
    }
  } catch (e) {
    safeLogError(`[workspaces] storage cleanup failed for ws=${id}:`, e);
  }

  return NextResponse.json({ ok: true });
}
