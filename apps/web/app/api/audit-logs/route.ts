import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100));
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
  return NextResponse.json(rows);
}
