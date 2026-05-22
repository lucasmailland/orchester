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
  const before = (
    await db
      .select({ provider: schema.aiProviders.provider })
      .from(schema.aiProviders)
      .where(and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.workspaceId, ctx.workspace.id)))
      .limit(1)
  )[0];
  const [d] = await db
    .delete(schema.aiProviders)
    .where(and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.workspaceId, ctx.workspace.id)))
    .returning({ id: schema.aiProviders.id });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "provider.delete",
    resource: "ai_provider",
    resourceId: id,
    before: before ? { provider: before.provider } : undefined,
  });
  return NextResponse.json({ ok: true });
}
