import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { checkQuota } from "@/lib/billing/quotas";

const createKbSchema = z.object({
  name: z.string().trim().min(1, "name required"),
  description: z.string().nullable().optional(),
  embeddingProvider: z.string().optional(),
  embeddingModel: z.string().optional(),
  chunkSize: z.number().optional(),
  chunkOverlap: z.number().optional(),
});

export async function GET() {
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      return tx
        .select()
        .from(schema.knowledgeBases)
        .where(eq(schema.knowledgeBases.workspaceId, ctx.workspace.id))
        .orderBy(desc(schema.knowledgeBases.updatedAt));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, createKbSchema);
  if (!parsed.ok) return parsed.response;
  const { name, description, embeddingProvider, embeddingModel, chunkSize, chunkOverlap } =
    parsed.data;

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const quota = await checkQuota(ctx.workspace.id, "knowledgeBases", tx);
      if (!quota.allowed) {
        return { _quotaError: quota.reason ?? "Knowledge base quota exceeded for your plan" };
      }
      const inserted = await tx
        .insert(schema.knowledgeBases)
        .values({
          id: createId(),
          workspaceId: ctx.workspace.id,
          name: name.trim(),
          description: description ?? null,
          embeddingProvider: embeddingProvider ?? "openai",
          embeddingModel: embeddingModel ?? "text-embedding-3-small",
          chunkSize: chunkSize ?? 800,
          chunkOverlap: chunkOverlap ?? 100,
        })
        .returning();
      const row = inserted[0];
      if (!row) return { _err: "Insert failed", _status: 500 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "knowledge.create",
        resource: "knowledge_base",
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
