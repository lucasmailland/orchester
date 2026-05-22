import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, eq, ne } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";

/**
 * DELETE /api/me/delete?confirm=<email>
 *
 * GDPR Article 17 — Right to erasure.
 *
 * Borra TODOS los datos del user actual:
 *   1. Verifica que `confirm` query param == user.email (anti-misclick)
 *   2. Para CADA workspace donde es OWNER ÚNICO: borra el workspace completo
 *      (cascade limpia agents, conversations, channels, KB, etc.)
 *   3. Para workspaces donde es miembro pero hay otros owners: sólo se quita
 *      como member.
 *   4. Borra todas sus sessions activas.
 *   5. Borra el user row (auth.account, auth.verification cascade).
 *
 * El audit log queda para forensics legal — entries con userId del afectado
 * NO se borran (compliance > GDPR para acciones admin previas).
 *
 * Response: 200 con resumen `{ workspacesDeleted, workspacesLeft, sessionsRevoked }`.
 *
 * Cookies: el endpoint NO desloguea automáticamente. El cliente debe redirigir
 * a /auth/login después del 200, donde la próxima petición fallará por sesión
 * inexistente y caerá al login form.
 */
export async function DELETE(req: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const confirm = url.searchParams.get("confirm") ?? "";
  if (confirm.toLowerCase() !== session.user.email.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Confirmation email mismatch — pass ?confirm=<your-email>",
        expected: session.user.email,
      },
      { status: 400 }
    );
  }

  const db = getDb();
  const userId = session.user.id;

  // 1. Recolectar todos los memberships del user.
  const memberships = await db
    .select()
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId));

  let workspacesDeleted = 0;
  let workspacesLeft = 0;

  for (const m of memberships) {
    if (m.role === "owner") {
      // ¿Hay otros owners?
      const otherOwners = await db
        .select({ id: schema.workspaceMembers.id })
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, m.workspaceId),
            eq(schema.workspaceMembers.role, "owner"),
            ne(schema.workspaceMembers.userId, userId)
          )
        );
      if (otherOwners.length === 0) {
        // Es el único owner → borra el workspace entero.
        const ws = (
          await db
            .select()
            .from(schema.workspaces)
            .where(eq(schema.workspaces.id, m.workspaceId))
            .limit(1)
        )[0];
        await logAudit({
          workspaceId: m.workspaceId,
          userId,
          action: "workspace.delete",
          resource: "workspace",
          resourceId: m.workspaceId,
          before: { name: ws?.name, slug: ws?.slug, reason: "user_gdpr_delete" },
        });
        await db
          .delete(schema.workspaces)
          .where(eq(schema.workspaces.id, m.workspaceId));
        workspacesDeleted++;
      } else {
        // Otro owner queda → quita al user del workspace.
        await db
          .delete(schema.workspaceMembers)
          .where(eq(schema.workspaceMembers.id, m.id));
        workspacesLeft++;
      }
    } else {
      // No es owner → simple membership delete.
      await db
        .delete(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.id, m.id));
      workspacesLeft++;
    }
  }

  // 2. Cerrar gaps de orphans: columnas que referencian al user por id PERO
  // sin FK con onDelete (no las cubre el cascade del user row). Si no las
  // limpiamos quedan apuntando a un user que ya no existe (GDPR Art. 17).
  //
  //   - messages.authorUserId : autor de mensajes "system" en takeover de
  //     operador. Texto plano, sin FK → null.
  //   - conversations.assignedToUserId : conversación asignada al operador.
  //     Texto plano, sin FK → null.
  //
  // El contenido de los mensajes en sí queda (es del workspace que sobrevive),
  // pero se desliga de la identidad del user borrado.
  await db
    .update(schema.messages)
    .set({ authorUserId: null })
    .where(eq(schema.messages.authorUserId, userId));

  await db
    .update(schema.conversations)
    .set({ assignedToUserId: null })
    .where(eq(schema.conversations.assignedToUserId, userId));

  // 3. Revocar todas las sessions del user.
  const revoked = await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .returning({ id: schema.sessions.id });

  // 4. Scrub de PII en la fila del user ANTES del delete. Defense-in-depth:
  // si por algún motivo (replica lag, backup en vuelo, soft-delete futuro) la
  // fila no desaparece atómicamente, ya no contiene datos personales.
  await db
    .update(schema.users)
    .set({
      name: "[deleted]",
      email: `deleted+${userId}@deleted.invalid`,
      image: null,
      emailVerified: false,
    })
    .where(eq(schema.users.id, userId));

  // 5. Borrar user (cascade: account, verification, two_factor, sessions,
  // workspace_member, notification_pref filas con FK onDelete cascade).
  // audit_log filas con userId se mantienen porque audit_log NO tiene FK con
  // onDelete cascade — es por diseño, los logs se preservan para forensics.
  await db.delete(schema.users).where(eq(schema.users.id, userId));

  // No podemos hacer logAudit DESPUÉS del user delete porque el user ya no
  // existe (audit_log.userId apunta a algo que ya no está). Lo logueamos
  // antes implícitamente con cada workspace.delete + sessions cascadea.

  return NextResponse.json({
    ok: true,
    workspacesDeleted,
    workspacesLeft,
    sessionsRevoked: revoked.length,
  });
}
