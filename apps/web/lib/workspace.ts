import "server-only";
import { auth } from "./auth";
import { headers } from "next/headers";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";

export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function getCurrentWorkspace() {
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
}

export async function requireSession(redirectTo = "/en/login") {
  const session = await getCurrentSession();
  if (!session) {
    const { redirect } = await import("next/navigation");
    redirect(redirectTo);
  }
  return session;
}
