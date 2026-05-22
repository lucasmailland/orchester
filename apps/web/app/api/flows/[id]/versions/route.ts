import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createFlowVersionSchema = z.object({
  label: z.string().nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flowVersions)
    .where(
      and(
        eq(schema.flowVersions.flowId, id),
        eq(schema.flowVersions.workspaceId, ws.workspace.id)
      )
    )
    .orderBy(desc(schema.flowVersions.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, createFlowVersionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = getDb();

  const flowRows = await db
    .select()
    .from(schema.flows)
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
    .limit(1);
  const flow = flowRows[0];
  if (!flow) return NextResponse.json({ error: "Flow not found" }, { status: 404 });

  // Bump flow.version, snapshot the current state into flow_version
  const newVersion = (flow.version ?? 1) + 1;
  await db
    .update(schema.flows)
    .set({ version: newVersion })
    .where(eq(schema.flows.id, id));

  const inserted = await db
    .insert(schema.flowVersions)
    .values({
      id: createId(),
      flowId: id,
      workspaceId: ctx.workspace.id,
      version: flow.version ?? 1,
      label: body.label ?? null,
      nodes: flow.nodes ?? [],
      edges: flow.edges ?? [],
      variables: flow.variables ?? {},
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
