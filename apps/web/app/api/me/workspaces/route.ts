import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { getCurrentSession } from "@/lib/workspace";

/**
 * GET /api/me/workspaces
 *
 * Returns every workspace the current user is a member of, ordered by
 * the workspace's `updatedAt` (most recently active first).
 *
 * Powers the workspace switcher in the sidebar plus the no-context
 * `/[locale]/workspaces` landing page.
 *
 * Marked `force-dynamic` because the response depends on the session
 * cookie and must never be statically cached at the edge.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.workspaces.id,
      slug: schema.workspaces.slug,
      name: schema.workspaces.name,
      status: schema.workspaces.status,
      timezone: schema.workspaces.timezone,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaceMembers.userId, session.user.id))
    .orderBy(desc(schema.workspaces.updatedAt));

  return NextResponse.json({ workspaces: rows });
}
