import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const updated = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.workspaceId, ctx.workspace.id)))
    .returning({ id: schema.apiKeys.id });
  if (!updated[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "apikey.revoke",
    resource: "api_key",
    resourceId: id,
  });
  return NextResponse.json({ ok: true });
}
