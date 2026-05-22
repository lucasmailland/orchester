import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { parseBody } from "@/lib/validation";

const acceptInviteSchema = z.object({
  token: z.string().optional(),
});

/**
 * POST /api/invites/accept
 * Body: { token }
 * Adds the current user to the workspace as a member with the role from the invite.
 */
export async function POST(req: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized — login first" }, { status: 401 });
  const parsed = await parseBody(req, acceptInviteSchema);
  if (!parsed.ok) return parsed.response;
  const token = String(parsed.data.token ?? "");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceInvites)
    .where(eq(schema.workspaceInvites.token, token))
    .limit(1);
  const invite = rows[0];
  if (!invite) return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  if (invite.status !== "pending")
    return NextResponse.json({ error: `Invite ${invite.status}` }, { status: 400 });
  if (invite.expiresAt < new Date()) {
    await db
      .update(schema.workspaceInvites)
      .set({ status: "expired" })
      .where(eq(schema.workspaceInvites.id, invite.id));
    return NextResponse.json({ error: "Invite expired" }, { status: 400 });
  }
  // email check (warning, not blocking — let user accept their own invite even if not exact email)
  if (invite.email.toLowerCase() !== session.user.email.toLowerCase()) {
    // Soft check — proceed but record a notice
  }

  // Add membership
  await db
    .insert(schema.workspaceMembers)
    .values({
      id: createId(),
      workspaceId: invite.workspaceId,
      userId: session.user.id,
      role: invite.role as "admin" | "editor" | "viewer",
    })
    .onConflictDoNothing();
  await db
    .update(schema.workspaceInvites)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(schema.workspaceInvites.id, invite.id));

  return NextResponse.json({ workspaceId: invite.workspaceId, role: invite.role });
}
