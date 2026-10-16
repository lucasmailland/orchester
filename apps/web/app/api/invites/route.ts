import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { checkQuota } from "@/lib/billing/quotas";
import { logAudit } from "@/lib/audit";
import { parseBody } from "@/lib/validation";
import { safeLogError } from "@/lib/safe-log";
import { escapeHtml } from "@/lib/html-escape";

const createInviteSchema = z.object({
  email: z.string().optional(),
  role: z.enum(["admin", "editor", "viewer"]).optional(),
});

export async function GET() {
  // workspace_invite is FORCE RLS — needs workspace GUC on the connection.
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const db = getDb();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .select()
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.workspaceId, ctx.workspace.id))
      .orderBy(desc(schema.workspaceInvites.createdAt));
  });
  // Don't leak the token in the list view
  return NextResponse.json(
    rows.map(({ token, ...rest }) => ({ ...rest, hasToken: Boolean(token) }))
  );
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const quota = await checkQuota(ctx.workspace.id, "members");
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason ?? "Member quota exceeded for your plan" },
      { status: 402 }
    );
  }
  const parsed = await parseBody(req, createInviteSchema);
  if (!parsed.ok) return parsed.response;
  const email = String(parsed.data.email ?? "")
    .trim()
    .toLowerCase();
  const role = parsed.data.role ?? "editor";
  if (!email || !email.includes("@"))
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const db = getDb();
  const invite = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const inserted = await tx
      .insert(schema.workspaceInvites)
      .values({
        id: createId(),
        workspaceId: ctx.workspace.id,
        email,
        role,
        token,
        invitedByUserId: ctx.user.id,
        expiresAt,
      })
      .returning();
    return inserted[0];
  });

  const inviteUrl = `${process.env["NEXT_PUBLIC_APP_URL"] ?? ""}/invite/${token}`;
  // The invite exists either way; report whether the email went out so the UI
  // can tell the inviter to share the link themselves.
  let emailStatus: "sent" | "not_configured" | "failed";
  try {
    const { sendEmail } = await import("@/lib/email");
    const workspaceName = escapeHtml(ctx.workspace.name);
    const result = await sendEmail({
      to: email,
      subject: `You've been invited to the ${ctx.workspace.name} workspace`,
      text: `Hi — you've been invited to ${ctx.workspace.name} on Orchester. Accept the invitation: ${inviteUrl}`,
      html: `<p>Hi — you've been invited to <b>${workspaceName}</b> on Orchester.</p><p><a href="${escapeHtml(inviteUrl)}">Accept invitation</a></p>`,
    });
    emailStatus = result.status;
  } catch (e) {
    safeLogError("[invites] email send failed:", e);
    emailStatus = "failed";
  }
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "invite.create",
    resource: "workspace_invite",
    resourceId: invite?.id,
    after: { email, role, emailStatus },
  });
  return NextResponse.json({ ...invite!, inviteUrl, emailStatus }, { status: 201 });
}

/**
 * DELETE /api/invites?id=...
 * Revoca una invitación pendiente. Sólo owner/admin del workspace.
 */
export async function DELETE(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getDb();
  const deletedId = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const deleted = await tx
      .delete(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.id, id))
      .returning({ id: schema.workspaceInvites.id });
    return deleted[0]?.id ?? null;
  });
  if (!deletedId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "invite.revoke",
    resource: "workspace_invite",
    resourceId: id,
  });
  return NextResponse.json({ ok: true });
}
