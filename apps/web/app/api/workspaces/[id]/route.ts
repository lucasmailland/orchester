import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";

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

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    timezone?: string;
  };

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
  const updated = await db
    .update(schema.workspaces)
    .set(set)
    .where(eq(schema.workspaces.id, id))
    .returning();
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
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  // Cascade en schema borra members, agents, conversations, etc.
  return NextResponse.json({ ok: true });
}
