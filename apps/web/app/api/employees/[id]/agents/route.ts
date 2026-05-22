import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const setEmployeeAgentsSchema = z.object({
  agentIds: z.array(z.string()),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, setEmployeeAgentsSchema);
  if (!parsed.ok) return parsed.response;
  const { agentIds } = parsed.data;
  const db = getDb();
  const updated = await db
    .update(schema.employees)
    .set({ assignedAgentIds: agentIds, updatedAt: new Date() })
    .where(and(eq(schema.employees.id, id), eq(schema.employees.workspaceId, ctx.workspace.id)))
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
