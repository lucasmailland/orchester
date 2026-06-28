import "server-only";
import { schema } from "@orchester/db";
import { eq, and, gte, sum, count, or, sql } from "drizzle-orm";
import { withWorkspaceTx } from "@/lib/tenant/context";

export interface DailyToken {
  date: string;
  tokens: number;
}

export interface AgentStat {
  id: string;
  name: string;
  model: string;
  conversations: number;
  tokens: number;
  costUsd: number;
}

export interface UsagePageData {
  tokensByDay: DailyToken[];
  agentUsage: AgentStat[];
  totalTokens: number;
  totalCostUsd: number;
  totalConversations: number;
}

export async function getUsagePageData(workspaceId: string): Promise<UsagePageData> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  return withWorkspaceTx(workspaceId, async (tx) => {
    const dailyRows = await tx
      .select({
        day: sql<string>`date_trunc('day', ${schema.usageEvents.createdAt})::date`,
        tokens: sum(schema.usageEvents.amount).mapWith(Number),
      })
      .from(schema.usageEvents)
      .where(
        and(
          eq(schema.usageEvents.workspaceId, workspaceId),
          gte(schema.usageEvents.createdAt, thirtyDaysAgo),
          or(eq(schema.usageEvents.kind, "tokens_in"), eq(schema.usageEvents.kind, "tokens_out"))
        )
      )
      .groupBy(sql`date_trunc('day', ${schema.usageEvents.createdAt})::date`)
      .orderBy(sql`date_trunc('day', ${schema.usageEvents.createdAt})::date`);

    const agentMetricRows = await tx
      .select({
        agentId: schema.usageEvents.agentId,
        kind: schema.usageEvents.kind,
        tokens: sum(schema.usageEvents.amount).mapWith(Number),
        costUsd: sum(schema.usageEvents.costUsd).mapWith(Number),
      })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.workspaceId, workspaceId))
      .groupBy(schema.usageEvents.agentId, schema.usageEvents.kind);

    const convCountRows = await tx
      .select({
        agentId: schema.conversations.agentId,
        cnt: count(),
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.workspaceId, workspaceId))
      .groupBy(schema.conversations.agentId);

    const agentRows = await tx
      .select({ id: schema.agents.id, name: schema.agents.name, model: schema.agents.model })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId))
      .orderBy(schema.agents.name);

    // Aggregate usage by agent
    const byAgent = new Map<string, { tokens: number; costUsd: number }>();
    for (const row of agentMetricRows) {
      if (!row.agentId) continue;
      const a = byAgent.get(row.agentId) ?? { tokens: 0, costUsd: 0 };
      if (row.kind === "tokens_in" || row.kind === "tokens_out") {
        a.tokens += row.tokens ?? 0;
      }
      a.costUsd += row.costUsd ?? 0;
      byAgent.set(row.agentId, a);
    }

    const byAgentConvs = new Map<string, number>();
    for (const row of convCountRows) {
      if (row.agentId) byAgentConvs.set(row.agentId, row.cnt);
    }

    const agentUsage: AgentStat[] = agentRows
      .map((a) => {
        const metrics = byAgent.get(a.id) ?? { tokens: 0, costUsd: 0 };
        return {
          id: a.id,
          name: a.name,
          model: a.model,
          conversations: byAgentConvs.get(a.id) ?? 0,
          tokens: metrics.tokens,
          costUsd: metrics.costUsd,
        };
      })
      .filter((a) => a.tokens > 0 || a.conversations > 0)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 20);

    const tokensByDay: DailyToken[] = dailyRows.map((r) => ({
      date: String(r.day),
      tokens: r.tokens ?? 0,
    }));

    const totalTokens = agentUsage.reduce((s, a) => s + a.tokens, 0);
    const totalCostUsd = agentUsage.reduce((s, a) => s + a.costUsd, 0);
    const totalConversations = agentUsage.reduce((s, a) => s + a.conversations, 0);

    return { tokensByDay, agentUsage, totalTokens, totalCostUsd, totalConversations };
  });
}
