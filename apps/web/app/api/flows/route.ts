import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, or, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { checkQuota } from "@/lib/billing/quotas";

const createFlowSchema = z.object({
  name: z.string().trim().min(1, "name required"),
  description: z.string().nullable().optional(),
  templateId: z.string().optional(),
  // Inline graph seed used by the Compass TemplatePicker. The server-side
  // `flowTemplates` table is the canonical source when `templateId` is set;
  // these fields let the client seed a brand-new flow from the static
  // client registry without round-tripping a DB row. Ignored if a
  // `templateId` resolves successfully (DB wins over client payload).
  nodes: z.array(z.unknown()).optional(),
  edges: z.array(z.unknown()).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.flows.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const quota = await checkQuota(ctx.workspace.id, "flows");
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason ?? "Flow quota exceeded for your plan" },
      { status: 402 }
    );
  }
  const parsed = await parseBody(req, createFlowSchema);
  if (!parsed.ok) return parsed.response;
  const {
    name,
    description,
    templateId,
    nodes: seedNodes,
    edges: seedEdges,
    variables: seedVars,
  } = parsed.data;
  const db = getDb();

  // Optional: load template. Server-stored templates win over inline seed,
  // so a saved organisational template can never be silently overridden by
  // a stale client payload.
  let initialNodes: unknown[] = seedNodes ?? [];
  let initialEdges: unknown[] = seedEdges ?? [];
  let initialVars: Record<string, unknown> = seedVars ?? {};
  if (templateId) {
    const tpls = await db
      .select()
      .from(schema.flowTemplates)
      .where(
        and(
          eq(schema.flowTemplates.id, templateId),
          or(
            eq(schema.flowTemplates.isPublic, true),
            eq(schema.flowTemplates.workspaceId, ctx.workspace.id)
          )
        )
      )
      .limit(1);
    const t = tpls[0];
    if (!t) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    initialNodes = (t.nodes as unknown[]) ?? [];
    initialEdges = (t.edges as unknown[]) ?? [];
    initialVars = (t.variables as Record<string, unknown>) ?? {};
  }

  // Sin template, el flujo arranca vacío: así el builder muestra el estado guiado
  // con plantillas y disparadores para empezar (el usuario elige cómo arrancar).

  const inserted = await db
    .insert(schema.flows)
    .values({
      id: createId(),
      workspaceId: ctx.workspace.id,
      name: name.trim(),
      description: description ?? null,
      nodes: initialNodes as never,
      edges: initialEdges as never,
      variables: initialVars,
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "flow.create",
    resource: "flow",
    resourceId: row.id,
    after: { name: row.name },
  });
  return NextResponse.json(row, { status: 201 });
}
