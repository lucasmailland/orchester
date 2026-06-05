import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
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
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.knowledgeBases.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const quota = await checkQuota(ctx.workspace.id, "knowledgeBases");
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason ?? "Knowledge base quota exceeded for your plan" },
      { status: 402 }
    );
  }
  const parsed = await parseBody(req, createKbSchema);
  if (!parsed.ok) return parsed.response;
  const { name, description, embeddingProvider, embeddingModel, chunkSize, chunkOverlap } =
    parsed.data;
  const db = getDb();
  const inserted = await db
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
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "knowledge.create",
    resource: "knowledge_base",
    resourceId: row.id,
    after: { name: row.name },
  });
  return NextResponse.json(row, { status: 201 });
}
