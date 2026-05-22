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

const createAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  role: z.string().trim().min(1, "Role is required"),
  systemPrompt: z.string().trim().min(1, "System prompt is required"),
  model: z.string().optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
  teamId: z.string().optional().nullable(),
});

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.agents.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const quota = await checkQuota(ctx.workspace.id, "agents");
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason ?? "Agent quota exceeded for your plan" },
      { status: 402 }
    );
  }

  const parsed = await parseBody(req, createAgentSchema);
  if (!parsed.ok) return parsed.response;
  const { name, role, systemPrompt, model, status, teamId } = parsed.data;

  const db = getDb();
  const [agent] = await db
    .insert(schema.agents)
    .values({
      id: createId(),
      workspaceId: ctx.workspace.id,
      teamId: teamId || null,
      name: name.trim(),
      role: role.trim(),
      systemPrompt: systemPrompt.trim(),
      model: model || "claude-sonnet-4-6",
      status: status || "draft",
    })
    .returning();

  if (agent) {
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "agent.create",
      resource: "agent",
      resourceId: agent.id,
      after: { name: agent.name, role: agent.role },
    });
  }

  return NextResponse.json(agent, { status: 201 });
}
