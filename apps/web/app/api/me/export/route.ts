import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";

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

  const userId = session.user.id;

  // GDPR self-service export pulls the user's footprint across every
  // workspace they belong to (data they own / authored / are subject
  // of). This is a legitimate cross-tenant read — we're returning the
  // calling user's data, not other tenants' data. Wrap in
  // withCrossTenantAdmin so the bypass is audit-logged and every
  // statement runs under the same admin context.
  const data = await withCrossTenantAdmin("me.export.gdpr_portability", async (tx) => {
    // 1. Profile (only the user's own row; exclude any secret material).
    const userRow = (
      await tx
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
    const memberships = await tx
      .select({
        membershipId: schema.workspaceMembers.id,
        workspaceId: schema.workspaceMembers.workspaceId,
        role: schema.workspaceMembers.role,
        joinedAt: schema.workspaceMembers.createdAt,
        workspaceName: schema.workspaces.name,
        workspaceSlug: schema.workspaces.slug,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
      .where(eq(schema.workspaceMembers.userId, userId))
      .limit(MAX_ROWS);

    // 3. Personal notification prefs (user-level only — workspace-level prefs
    // have userId null and are not personal data of this user).
    const notificationPrefs = await tx
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
    const assignedConversations = await tx
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
    const authoredMessages = await tx
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

    // 6. Audit-log entries ABOUT this user (actor == self). Scoped to actions
    // the user themselves performed / that reference them. Reads from the
    // new hash-chained `audit_log` table; the pre-rename historical entries
    // are merged from `audit_log_legacy` so existing users see the same
    // history they saw before the migration. Both projections are normalized
    // to the same shape; chain-only fields (seq/prev_hash/chain_hash) are
    // intentionally excluded — the verification cron exposes them via a
    // separate admin endpoint.
    const newAudit = await tx
      .select({
        id: schema.auditLog.id,
        workspaceId: schema.auditLog.workspaceId,
        action: schema.auditLog.action,
        resource: schema.auditLog.targetType,
        resourceId: schema.auditLog.targetId,
        ip: schema.auditLog.actorIp,
        userAgent: schema.auditLog.actorUserAgent,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, userId))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(MAX_ROWS);

    const legacyAudit = await tx
      .select({
        id: schema.auditLogsLegacy.id,
        workspaceId: schema.auditLogsLegacy.workspaceId,
        action: schema.auditLogsLegacy.action,
        resource: schema.auditLogsLegacy.resource,
        resourceId: schema.auditLogsLegacy.resourceId,
        ip: schema.auditLogsLegacy.ip,
        userAgent: schema.auditLogsLegacy.userAgent,
        createdAt: schema.auditLogsLegacy.createdAt,
      })
      .from(schema.auditLogsLegacy)
      .where(eq(schema.auditLogsLegacy.userId, userId))
      .orderBy(desc(schema.auditLogsLegacy.createdAt))
      .limit(MAX_ROWS);

    const auditEntries = [...newAudit, ...legacyAudit]
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .slice(0, MAX_ROWS);

    return {
      userRow,
      memberships,
      notificationPrefs,
      assignedConversations,
      authoredMessages,
      auditEntries,
    };
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    subject: { userId },
    profile: data.userRow ?? null,
    memberships: data.memberships,
    notificationPrefs: data.notificationPrefs,
    assignedConversations: data.assignedConversations,
    authoredMessages: data.authoredMessages,
    auditEntries: data.auditEntries,
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
