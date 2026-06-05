import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, asc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createLabelSchema = z.object({
  name: z.string().trim().min(1, "name required"),
  color: z.string().optional(),
});

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.conversationLabels)
    .where(eq(schema.conversationLabels.workspaceId, ws.workspace.id))
    .orderBy(asc(schema.conversationLabels.name));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, createLabelSchema);
  if (!parsed.ok) return parsed.response;
  const { name, color } = parsed.data;
  const db = getDb();
  const inserted = await db
    .insert(schema.conversationLabels)
    .values({
      id: createId(),
      workspaceId: ctx.workspace.id,
      name: name.trim(),
      color: color ?? "#8b5cf6",
    })
    .returning();
  return NextResponse.json(inserted[0]!, { status: 201 });
}
