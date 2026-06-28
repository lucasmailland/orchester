import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { updateKnowledgeBase } from "@/lib/knowledge/kb-store";

const updateKbSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  chunkSize: z.number().optional(),
  chunkOverlap: z.number().optional(),
  embeddingModel: z.string().optional(),
  embeddingProvider: z.string().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      const rows = await tx
        .select()
        .from(schema.knowledgeBases)
        .where(
          and(
            eq(schema.knowledgeBases.id, id),
            eq(schema.knowledgeBases.workspaceId, ctx.workspace.id)
          )
        )
        .limit(1);
      const row = rows[0];
      if (!row) return { _err: "Not found", _status: 404 };
      return { row };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, updateKbSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, tx }) => {
      try {
        await updateKnowledgeBase(ctx.workspace.id, id, body);
      } catch (e) {
        if (e instanceof Error && /re-index/i.test(e.message)) {
          return { _err: e.message, _status: 409 as const };
        }
        throw e;
      }
      const rows = await tx
        .select()
        .from(schema.knowledgeBases)
        .where(
          and(
            eq(schema.knowledgeBases.id, id),
            eq(schema.knowledgeBases.workspaceId, ctx.workspace.id)
          )
        )
        .limit(1);
      const row = rows[0];
      if (!row) return { _err: "Not found", _status: 404 as const };
      return { row };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const before = (
        await tx
          .select({ name: schema.knowledgeBases.name })
          .from(schema.knowledgeBases)
          .where(
            and(
              eq(schema.knowledgeBases.id, id),
              eq(schema.knowledgeBases.workspaceId, ctx.workspace.id)
            )
          )
          .limit(1)
      )[0];
      const deleted = await tx
        .delete(schema.knowledgeBases)
        .where(
          and(
            eq(schema.knowledgeBases.id, id),
            eq(schema.knowledgeBases.workspaceId, ctx.workspace.id)
          )
        )
        .returning({ id: schema.knowledgeBases.id });
      if (!deleted[0]) return { _err: "Not found", _status: 404 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "knowledge.delete",
        resource: "knowledge_base",
        resourceId: id,
        before: before ? { name: before.name } : undefined,
      });
      return { ok: true };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result);
}
