import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceInvites)
    .where(eq(schema.workspaceInvites.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.workspaceInvites.createdAt));
  // Don't leak the token in the list view
  return NextResponse.json(
    rows.map(({ token, ...rest }) => ({ ...rest, hasToken: Boolean(token) }))
  );
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  const session = await getCurrentSession();
  if (!ws || !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const role = (body?.role ?? "editor") as "admin" | "editor" | "viewer";
  if (!email || !email.includes("@"))
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (!["admin", "editor", "viewer"].includes(role))
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const db = getDb();
  const inserted = await db
    .insert(schema.workspaceInvites)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      email,
      role,
      token,
      invitedByUserId: session.user.id,
      expiresAt,
    })
    .returning();

  const inviteUrl = `${process.env["NEXT_PUBLIC_APP_URL"] ?? ""}/invite/${token}`;
  // Send email via lib/email if configured (fail silent for self-serve)
  try {
    const { sendEmail } = await import("@/lib/email");
    await sendEmail({
      to: email,
      subject: `Te invitaron al workspace ${ws.workspace.name}`,
      text: `Hola, te invitaron a ${ws.workspace.name} en Orchester. Aceptá la invitación: ${inviteUrl}`,
      html: `<p>Hola, te invitaron a <b>${ws.workspace.name}</b> en Orchester.</p><p><a href="${inviteUrl}">Aceptar invitación</a></p>`,
    });
  } catch {}
  await logAudit({
    workspaceId: ws.workspace.id,
    userId: session.user.id,
    action: "invite.create",
    resource: "workspace_invite",
    resourceId: inserted[0]?.id,
    after: { email, role },
  });
  return NextResponse.json({ ...inserted[0]!, inviteUrl }, { status: 201 });
}
