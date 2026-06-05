import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, eq, ne } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";

/**
 * GET /api/sessions
 * Lista las sesiones activas del user actual (todas las del cookie better-auth).
 *
 * DELETE /api/sessions?id=xxx
 * Revoca una sesión específica. No permite revocar la sesión actual (usá logout).
 *
 * DELETE /api/sessions?all=true
 * Revoca TODAS las sesiones del user excepto la actual. Útil ante "creo que
 * me hackearon" — un click cierra todos los devices remotos.
 */

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select({
      id: schema.sessions.id,
      ipAddress: schema.sessions.ipAddress,
      userAgent: schema.sessions.userAgent,
      createdAt: schema.sessions.createdAt,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, session.user.id));

  return NextResponse.json({
    sessions: rows.map((r) => ({
      ...r,
      isCurrent: r.id === session.session.id,
    })),
  });
}

export async function DELETE(req: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const all = url.searchParams.get("all") === "true";

  if (!id && !all) {
    return NextResponse.json({ error: "id or all=true required" }, { status: 400 });
  }

  const db = getDb();
  const currentId = session.session.id;

  if (all) {
    // Borra todas las sesiones del user excepto la actual.
    const deleted = await db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.userId, session.user.id), ne(schema.sessions.id, currentId)))
      .returning({ id: schema.sessions.id });
    await logAudit({
      // No tenemos workspaceId acá fácil. Lo dejamos vacío — audit_log permite
      // workspaceId vacío si la action es a nivel user-global.
      workspaceId: "",
      userId: session.user.id,
      action: "session.revoke_all",
      resource: "session",
      after: { count: deleted.length },
    });
    return NextResponse.json({ ok: true, revoked: deleted.length });
  }

  if (id === currentId) {
    return NextResponse.json(
      { error: "Cannot revoke current session — use logout instead" },
      { status: 400 }
    );
  }

  const deleted = await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.id, id!), eq(schema.sessions.userId, session.user.id)))
    .returning({ id: schema.sessions.id });

  if (!deleted[0]) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  await logAudit({
    workspaceId: "",
    userId: session.user.id,
    action: "session.revoke",
    resource: "session",
    resourceId: id ?? undefined,
  });
  return NextResponse.json({ ok: true });
}
