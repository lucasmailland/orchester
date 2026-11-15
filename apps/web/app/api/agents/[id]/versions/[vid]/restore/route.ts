import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { restoreAgentVersion } from "@/lib/agents/restore";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id, vid } = await params;
  try {
    await restoreAgentVersion(ctx.workspace.id, id, vid);
  } catch (e) {
    if (e instanceof Error && e.message === "Version not found")
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    throw e;
  }
  const db = getDb();
  const row = (
    await db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
      .limit(1)
  )[0];
  if (!row) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json(row);
}
