import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";

/**
 * GET /api/me/export
 *
 * GDPR Article 20 — Right to data portability.
 *
 * Self-service export of the calling user's PERSONAL data as a JSON download:
 *   - profile (user row, minus secrets)
 *   - workspace memberships (id/role/workspace name+slug)
 *   - personal notification prefs (user-level only)
 *   - authored content metadata: conversations assigned to them + system
 *     messages they authored (operator takeover), bounded + metadata-level
 *   - audit_log entries ABOUT them (userId == self)
 *
 * Strictly scoped to the calling user — no cross-tenant or other-user data.
 * Read-only and bounded with explicit limits.
 */
const MAX_ROWS = 5_000;

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const userId = session.user.id;

  // 1. Profile (only the user's own row; exclude any secret material).
  const userRow = (
    await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        emailVerified: schema.users.emailVerified,
        image: schema.users.image,
        onboardingCompleted: schema.users.onboardingCompleted,
        preferredLocale: schema.users.preferredLocale,
        preferredTheme: schema.users.preferredTheme,
        twoFactorEnabled: schema.users.twoFactorEnabled,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
  )[0];

  // 2. Memberships (join workspace for human-readable name/slug).
  const memberships = await db
    .select({
      membershipId: schema.workspaceMembers.id,
      workspaceId: schema.workspaceMembers.workspaceId,
      role: schema.workspaceMembers.role,
      joinedAt: schema.workspaceMembers.createdAt,
      workspaceName: schema.workspaces.name,
      workspaceSlug: schema.workspaces.slug,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaceMembers.workspaceId, schema.workspaces.id)
    )
    .where(eq(schema.workspaceMembers.userId, userId))
    .limit(MAX_ROWS);

  // 3. Personal notification prefs (user-level only — workspace-level prefs
  // have userId null and are not personal data of this user).
  const notificationPrefs = await db
    .select({
      key: schema.notificationPrefs.key,
      enabled: schema.notificationPrefs.enabled,
      workspaceId: schema.notificationPrefs.workspaceId,
      updatedAt: schema.notificationPrefs.updatedAt,
    })
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId))
    .limit(MAX_ROWS);

  // 4. Conversations assigned to the user (operator takeover). Metadata only.
  const assignedConversations = await db
    .select({
      id: schema.conversations.id,
      workspaceId: schema.conversations.workspaceId,
      status: schema.conversations.status,
      summary: schema.conversations.summary,
      messageCount: schema.conversations.messageCount,
      takenOverAt: schema.conversations.takenOverAt,
      startedAt: schema.conversations.startedAt,
      endedAt: schema.conversations.endedAt,
      createdAt: schema.conversations.createdAt,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.assignedToUserId, userId))
    .orderBy(desc(schema.conversations.createdAt))
    .limit(MAX_ROWS);

  // 5. System messages the user authored (operator replies during takeover).
  const authoredMessages = await db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      role: schema.messages.role,
      content: schema.messages.content,
      fromOperator: schema.messages.fromOperator,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(eq(schema.messages.authorUserId, userId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(MAX_ROWS);

  // 6. Audit-log entries ABOUT this user (userId == self). Scoped to actions
  // the user themselves performed / that reference them.
  const auditEntries = await db
    .select({
      id: schema.auditLogs.id,
      workspaceId: schema.auditLogs.workspaceId,
      action: schema.auditLogs.action,
      resource: schema.auditLogs.resource,
      resourceId: schema.auditLogs.resourceId,
      ip: schema.auditLogs.ip,
      userAgent: schema.auditLogs.userAgent,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.userId, userId))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(MAX_ROWS);

  const payload = {
    exportedAt: new Date().toISOString(),
    subject: { userId },
    profile: userRow ?? null,
    memberships,
    notificationPrefs,
    assignedConversations,
    authoredMessages,
    auditEntries,
    limits: { maxRowsPerCollection: MAX_ROWS },
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="orchester-data-export-${userId}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
