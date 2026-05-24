import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id, vid } = await params;
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const versions = await tx
      .select()
      .from(schema.flowVersions)
      .where(
        and(
          eq(schema.flowVersions.id, vid),
          eq(schema.flowVersions.flowId, id),
          eq(schema.flowVersions.workspaceId, ctx.workspace.id)
        )
      )
      .limit(1);
    const v = versions[0];
    if (!v) return { kind: "version_not_found" as const };

    const updated = await tx
      .update(schema.flows)
      .set({
        nodes: v.nodes ?? [],
        edges: v.edges ?? [],
        variables: v.variables ?? {},
        updatedAt: new Date(),
      })
      .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
      .returning();
    const row = updated[0];
    if (!row) return { kind: "flow_not_found" as const };
    return { kind: "ok" as const, row };
  });

  if (result.kind === "version_not_found")
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  if (result.kind === "flow_not_found")
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  return NextResponse.json(result.row);
}
