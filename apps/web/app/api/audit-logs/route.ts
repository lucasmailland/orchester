import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export async function GET(req: Request) {
  // Logs de auditoría son sensibles → sólo admin+ pueden leerlos.
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const url = new URL(req.url);
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100));
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.workspaceId, ctx.workspace.id))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
  return NextResponse.json(rows);
}
