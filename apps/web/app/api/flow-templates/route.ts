import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, or, and, asc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

/**
 * Returns: public templates + workspace-private templates.
 */
export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flowTemplates)
    .where(
      or(
        eq(schema.flowTemplates.isPublic, true),
        and(
          eq(schema.flowTemplates.isPublic, false),
          eq(schema.flowTemplates.workspaceId, ws.workspace.id)
        )
      )
    )
    .orderBy(asc(schema.flowTemplates.category), asc(schema.flowTemplates.name));
  return NextResponse.json(rows);
}
