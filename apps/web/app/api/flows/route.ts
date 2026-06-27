import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { eq, and, or, desc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
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
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      return tx
        .select()
        .from(schema.flows)
        .where(eq(schema.flows.workspaceId, ctx.workspace.id))
        .orderBy(desc(schema.flows.updatedAt));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
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

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const quota = await checkQuota(ctx.workspace.id, "flows", tx);
      if (!quota.allowed) {
        return { _quotaError: quota.reason ?? "Flow quota exceeded for your plan" };
      }

      // Optional: load template. Server-stored templates win over inline seed,
      // so a saved organisational template can never be silently overridden by
      // a stale client payload.
      let initialNodes: unknown[] = seedNodes ?? [];
      let initialEdges: unknown[] = seedEdges ?? [];
      let initialVars: Record<string, unknown> = seedVars ?? {};
      if (templateId) {
        const tpls = await tx
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
        if (!t) return { _err: "Template not found", _status: 404 };
        initialNodes = (t.nodes as unknown[]) ?? [];
        initialEdges = (t.edges as unknown[]) ?? [];
        initialVars = (t.variables as Record<string, unknown>) ?? {};
      }

      // Sin template, el flujo arranca vacío: así el builder muestra el estado guiado
      // con plantillas y disparadores para empezar (el usuario elige cómo arrancar).

      const inserted = await tx
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
      if (!row) return { _err: "Insert failed", _status: 500 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "flow.create",
        resource: "flow",
        resourceId: row.id,
        after: { name: row.name },
      });
      return { row };
    },
  });
  if (result instanceof Response) return result;
  if ("_quotaError" in result)
    return NextResponse.json({ error: result._quotaError }, { status: 402 });
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.row, { status: 201 });
}
