import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, and, gte, sum } from "drizzle-orm";
import { planLimits, type Plan } from "./plans";

export async function getWorkspacePlan(workspaceId: string): Promise<Plan> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceBilling)
    .where(eq(schema.workspaceBilling.workspaceId, workspaceId))
    .limit(1);
  return (rows[0]?.plan ?? "free") as Plan;
}

/**
 * Returns current month's usage for a workspace.
 */
export async function getMonthlyUsage(workspaceId: string) {
  const db = getDb();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({
      kind: schema.usageEvents.kind,
      total: sum(schema.usageEvents.amount).mapWith(Number),
    })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.workspaceId, workspaceId),
        gte(schema.usageEvents.createdAt, start)
      )
    )
    .groupBy(schema.usageEvents.kind);
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = r.total ?? 0;
  return {
    conversations: byKind["agent_message"] ?? 0,
    tokensIn: byKind["tokens_in"] ?? 0,
    tokensOut: byKind["tokens_out"] ?? 0,
    flowRuns: byKind["flow_run"] ?? 0,
    kbQueries: byKind["kb_query"] ?? 0,
    webhookCalls: byKind["webhook_call"] ?? 0,
  };
}

/**
 * Checks if the workspace can perform an action under its plan.
 * Returns null if allowed, or a string explaining the limit.
 */
export async function checkQuota(
  workspaceId: string,
  kind: "conversations" | "tokens" | "agents" | "flows" | "members" | "knowledgeBases"
): Promise<{ allowed: boolean; limit?: number | undefined; current?: number | undefined; reason?: string | undefined }> {
  const plan = await getWorkspacePlan(workspaceId);
  const limits = planLimits(plan);

  if (kind === "conversations") {
    const usage = await getMonthlyUsage(workspaceId);
    if (usage.conversations >= limits.conversationsPerMonth) {
      return {
        allowed: false,
        limit: limits.conversationsPerMonth,
        current: usage.conversations,
        reason: `Plan ${plan} permite ${limits.conversationsPerMonth} conversaciones/mes`,
      };
    }
    return { allowed: true, limit: limits.conversationsPerMonth, current: usage.conversations };
  }

  if (kind === "tokens") {
    const usage = await getMonthlyUsage(workspaceId);
    const total = usage.tokensIn + usage.tokensOut;
    if (total >= limits.tokensPerMonth) {
      return {
        allowed: false,
        limit: limits.tokensPerMonth,
        current: total,
        reason: `Plan ${plan} permite ${limits.tokensPerMonth} tokens/mes`,
      };
    }
    return { allowed: true, limit: limits.tokensPerMonth, current: total };
  }

  // Resource-count quotas
  const db = getDb();
  let current = 0;
  if (kind === "agents") {
    const r = await db
      .select({ count: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId));
    current = r.length;
  } else if (kind === "flows") {
    const r = await db
      .select({ count: schema.flows.id })
      .from(schema.flows)
      .where(eq(schema.flows.workspaceId, workspaceId));
    current = r.length;
  } else if (kind === "members") {
    const r = await db
      .select({ count: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
    current = r.length;
  } else if (kind === "knowledgeBases") {
    const r = await db
      .select({ count: schema.knowledgeBases.id })
      .from(schema.knowledgeBases)
      .where(eq(schema.knowledgeBases.workspaceId, workspaceId));
    current = r.length;
  }
  const limit = limits[kind === "knowledgeBases" ? "knowledgeBases" : (kind as keyof typeof limits)];
  if (typeof limit === "number" && current >= limit) {
    return {
      allowed: false,
      limit,
      current,
      reason: `Plan ${plan} permite ${limit} ${kind}`,
    };
  }
  return { allowed: true, limit: typeof limit === "number" ? limit : undefined, current };
}
