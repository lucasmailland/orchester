import "server-only";
import { cache } from "react";
import { auth } from "./auth";
import { headers } from "next/headers";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";

/**
 * `cache()` deduplicates calls within a single React request — if 5 server
 * components call getCurrentSession(), there's still only ONE auth lookup.
 * Big win because the shell layout + 3-4 loaders all hit this.
 */
export const getCurrentSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export const getCurrentWorkspace = cache(async () => {
  const session = await getCurrentSession();
  if (!session) return null;

  const db = getDb();
  const result = await db
    .select({ workspace: schema.workspaces, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaceMembers.userId, session.user.id))
    .limit(1);

  return result[0] ?? null;
});

export async function requireSession(redirectTo = "/en/login") {
  const session = await getCurrentSession();
  if (!session) {
    const { redirect } = await import("next/navigation");
    redirect(redirectTo);
  }
  return session;
}
