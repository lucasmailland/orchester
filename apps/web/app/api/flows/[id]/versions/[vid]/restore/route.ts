import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { restorePatch } from "@/lib/flows/versions";
import { storedActionIssues } from "@/lib/flows/action-guard";

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

    const currentRows = await tx
      .select()
      .from(schema.flows)
      .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
      .limit(1);
    const current = currentRows[0];
    if (!current) return { kind: "flow_not_found" as const };
    // An enabled action must keep satisfying its contract; the same rule as `updateFlow`.
    if (current.kind === "action" && current.enabled) {
      const patch = restorePatch(v);
      const issues = storedActionIssues({
        kind: "action",
        nodes: patch.nodes,
        variables: patch.variables,
      });
      if (issues.length > 0) return { kind: "contract" as const, issues };
    }

    const updated = await tx
      .update(schema.flows)
      .set({
        ...restorePatch(v),
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
  if (result.kind === "contract")
    return NextResponse.json(
      {
        error:
          "An enabled action must satisfy the action contract; disable it or pick another version",
        issues: result.issues,
      },
      { status: 422 }
    );
  if (result.kind === "flow_not_found")
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  return NextResponse.json(result.row);
}
