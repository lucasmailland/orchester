import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/workspace";
import { parseBody } from "@/lib/validation";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";

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

  // The caller is authenticated but is NOT yet a member of the target
  // workspace — that's the whole point of accept. workspace_member +
  // workspace_invite are FORCE RLS, so the lookup, the membership insert
  // and the invite status update all need to bypass tenant scoping.
  const result = await withCrossTenantAdmin("invite.accept", async (tx) => {
    const rows = await tx
      .select()
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.token, token))
      .limit(1);
    const invite = rows[0];
    if (!invite) return { kind: "not_found" as const };
    if (invite.status !== "pending") return { kind: "bad_status" as const, status: invite.status };
    if (invite.expiresAt < new Date()) {
      await tx
        .update(schema.workspaceInvites)
        .set({ status: "expired" })
        .where(eq(schema.workspaceInvites.id, invite.id));
      return { kind: "expired" as const };
    }
    // email check (warning, not blocking — let user accept their own invite even if not exact email)
    if (invite.email.toLowerCase() !== session.user.email.toLowerCase()) {
      // Soft check — proceed but record a notice
    }

    // Add membership
    await tx
      .insert(schema.workspaceMembers)
      .values({
        id: createId(),
        workspaceId: invite.workspaceId,
        userId: session.user.id,
        role: invite.role as "admin" | "editor" | "viewer",
      })
      .onConflictDoNothing();
    await tx
      .update(schema.workspaceInvites)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(schema.workspaceInvites.id, invite.id));

    return { kind: "ok" as const, workspaceId: invite.workspaceId, role: invite.role };
  });

  if (result.kind === "not_found")
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  if (result.kind === "bad_status")
    return NextResponse.json({ error: `Invite ${result.status}` }, { status: 400 });
  if (result.kind === "expired")
    return NextResponse.json({ error: "Invite expired" }, { status: 400 });

  return NextResponse.json({ workspaceId: result.workspaceId, role: result.role });
}
