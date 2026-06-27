import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
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
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      return tx
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.workspaceId, ctx.workspace.id))
        .orderBy(desc(schema.agents.updatedAt));
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, createAgentSchema);
  if (!parsed.ok) return parsed.response;
  const { name, role, systemPrompt, model, status, teamId } = parsed.data;

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const quota = await checkQuota(ctx.workspace.id, "agents", tx);
      if (!quota.allowed) {
        return { _quotaError: quota.reason ?? "Agent quota exceeded for your plan" };
      }

      const [agent] = await tx
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
          userId: user.id,
          action: "agent.create",
          resource: "agent",
          resourceId: agent.id,
          after: { name: agent.name, role: agent.role },
        });
      }

      return { agent };
    },
  });
  if (result instanceof Response) return result;
  if ("_quotaError" in result) {
    return NextResponse.json({ error: result._quotaError }, { status: 402 });
  }
  return NextResponse.json(result.agent, { status: 201 });
}
