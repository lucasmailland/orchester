import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/** Defaults must match NOTIFICATION_KEYS in app/api/notification-prefs/route.ts. */
export const NOTIFICATION_DEFAULTS: Record<string, boolean> = {
  conv_escalated: true,
  agent_down: true,
  weekly_report: false,
  new_member: true,
};

/** Resolve a single key for one user: user-pref > workspace-pref > default. */
export async function resolveNotificationPref(
  workspaceId: string,
  userId: string,
  key: string,
  tx?: WsDb
): Promise<boolean> {
  const db = tx ?? getDb();
  const rows = await db
    .select()
    .from(schema.notificationPrefs)
    .where(
      and(
        eq(schema.notificationPrefs.workspaceId, workspaceId),
        eq(schema.notificationPrefs.key, key),
        or(eq(schema.notificationPrefs.userId, userId), isNull(schema.notificationPrefs.userId))!
      )
    );
  const userVal = rows.find((r) => r.userId === userId)?.enabled;
  const wsVal = rows.find((r) => r.userId === null)?.enabled;
  return userVal ?? wsVal ?? NOTIFICATION_DEFAULTS[key] ?? false;
}

/** Members (id+email) whose pref for `key` resolves ON. */
export async function recipientsFor(
  workspaceId: string,
  key: string,
  tx?: WsDb
): Promise<Array<{ userId: string; email: string }>> {
  const db = tx ?? getDb();
  const members = await db
    .select({ userId: schema.users.id, email: schema.users.email })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.workspaceMembers.userId, schema.users.id))
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
  const out: Array<{ userId: string; email: string }> = [];
  for (const m of members) {
    if (await resolveNotificationPref(workspaceId, m.userId, key, tx)) {
      out.push(m);
    }
  }
  return out;
}
