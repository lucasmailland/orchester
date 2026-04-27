import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, count, countDistinct, and, gte, sql, desc } from "drizzle-orm";

export interface DashboardStats {
  activeAgents: number;
  conversationsToday: number;
  totalEmployees: number;
  avgDurationSeconds: number;
  conversationsByDay: { date: string; count: number }[];
}

export async function getDashboardStats(workspaceId: string): Promise<DashboardStats> {
  const db = getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [activeAgentsResult, conversationsTodayResult, totalEmployeesResult, avgDurationResult, byDayResult] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(schema.agents)
        .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.status, "active"))),

      db
        .select({ value: count() })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, today)
        )),

      db
        .select({ value: count() })
        .from(schema.employees)
        .where(and(
          eq(schema.employees.workspaceId, workspaceId),
          eq(schema.employees.active, true)
        )),

      db
        .select({ value: sql<number>`coalesce(avg(${schema.conversations.durationSeconds}), 0)` })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )),

      db
        .select({
          date: sql<string>`date(${schema.conversations.startedAt})`,
          count: count(),
        })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        ))
        .groupBy(sql`date(${schema.conversations.startedAt})`),
    ]);

  return {
    activeAgents: activeAgentsResult[0]?.value ?? 0,
    conversationsToday: conversationsTodayResult[0]?.value ?? 0,
    totalEmployees: totalEmployeesResult[0]?.value ?? 0,
    avgDurationSeconds: Math.round(Number(avgDurationResult[0]?.value ?? 0)),
    conversationsByDay: byDayResult.map((r) => ({ date: r.date, count: r.count })),
  };
}

export async function getTeams(workspaceId: string) {
  const db = getDb();
  const [rows, agentCounts, channelCounts] = await Promise.all([
    db
      .select({
        id: schema.teams.id,
        name: schema.teams.name,
        description: schema.teams.description,
        avatarColor: schema.teams.avatarColor,
        createdAt: schema.teams.createdAt,
      })
      .from(schema.teams)
      .where(eq(schema.teams.workspaceId, workspaceId)),

    db
      .select({ teamId: schema.agents.teamId, count: count() })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId))
      .groupBy(schema.agents.teamId),

    db
      .select({ teamId: schema.channels.teamId, count: count() })
      .from(schema.channels)
      .where(eq(schema.channels.workspaceId, workspaceId))
      .groupBy(schema.channels.teamId),
  ]);

  const agentMap = Object.fromEntries(agentCounts.map((r) => [r.teamId ?? "", r.count]));
  const channelMap = Object.fromEntries(channelCounts.map((r) => [r.teamId ?? "", r.count]));

  return rows.map((t) => ({
    ...t,
    agentCount: agentMap[t.id] ?? 0,
    channelCount: channelMap[t.id] ?? 0,
  }));
}

export async function getAgents(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      role: schema.agents.role,
      model: schema.agents.model,
      status: schema.agents.status,
      systemPrompt: schema.agents.systemPrompt,
      teamId: schema.agents.teamId,
      teamName: schema.teams.name,
      createdAt: schema.agents.createdAt,
    })
    .from(schema.agents)
    .leftJoin(schema.teams, eq(schema.agents.teamId, schema.teams.id))
    .where(eq(schema.agents.workspaceId, workspaceId))
    .orderBy(desc(schema.agents.createdAt));
}

export async function getTeamById(workspaceId: string, teamId: string) {
  const db = getDb();
  const [team] = await db
    .select()
    .from(schema.teams)
    .where(and(eq(schema.teams.id, teamId), eq(schema.teams.workspaceId, workspaceId)))
    .limit(1);
  return team ?? null;
}

export async function getTeamAgents(workspaceId: string, teamId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      role: schema.agents.role,
      model: schema.agents.model,
      status: schema.agents.status,
      systemPrompt: schema.agents.systemPrompt,
      createdAt: schema.agents.createdAt,
    })
    .from(schema.agents)
    .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.teamId, teamId)))
    .orderBy(desc(schema.agents.createdAt));
}

export async function getTeamChannels(workspaceId: string, teamId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.channels.id,
      name: schema.channels.name,
      type: schema.channels.type,
      status: schema.channels.status,
    })
    .from(schema.channels)
    .where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.teamId, teamId)))
    .orderBy(schema.channels.name);
}

export async function getEmployees(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.employees.id,
      name: schema.employees.name,
      email: schema.employees.email,
      phone: schema.employees.phone,
      area: schema.employees.area,
      active: schema.employees.active,
      createdAt: schema.employees.createdAt,
    })
    .from(schema.employees)
    .where(eq(schema.employees.workspaceId, workspaceId))
    .orderBy(schema.employees.name);
}

export interface OrgAgent {
  id: string;
  name: string;
  role: string;
  model: string;
  status: "active" | "inactive" | "draft";
}

export interface OrgTeam {
  id: string;
  name: string;
  description: string | null;
  avatarColor: string | null;
  agents: OrgAgent[];
}

export async function getOrgData(workspaceId: string): Promise<OrgTeam[]> {
  const db = getDb();
  const rows = await db
    .select({
      teamId: schema.teams.id,
      teamName: schema.teams.name,
      teamDescription: schema.teams.description,
      teamAvatarColor: schema.teams.avatarColor,
      agentId: schema.agents.id,
      agentName: schema.agents.name,
      agentRole: schema.agents.role,
      agentModel: schema.agents.model,
      agentStatus: schema.agents.status,
    })
    .from(schema.teams)
    .leftJoin(
      schema.agents,
      and(eq(schema.agents.teamId, schema.teams.id), eq(schema.agents.workspaceId, workspaceId))
    )
    .where(eq(schema.teams.workspaceId, workspaceId))
    .orderBy(schema.teams.name, schema.agents.name);

  const teamMap = new Map<string, OrgTeam>();
  for (const row of rows) {
    if (!teamMap.has(row.teamId)) {
      teamMap.set(row.teamId, {
        id: row.teamId,
        name: row.teamName,
        description: row.teamDescription,
        avatarColor: row.teamAvatarColor,
        agents: [],
      });
    }
    if (row.agentId) {
      teamMap.get(row.teamId)!.agents.push({
        id: row.agentId,
        name: row.agentName!,
        role: row.agentRole!,
        model: row.agentModel!,
        status: row.agentStatus!,
      });
    }
  }
  return Array.from(teamMap.values());
}

export async function getConversations(workspaceId: string, limit = 50) {
  const db = getDb();
  return db
    .select({
      id: schema.conversations.id,
      status: schema.conversations.status,
      messageCount: schema.conversations.messageCount,
      durationSeconds: schema.conversations.durationSeconds,
      startedAt: schema.conversations.startedAt,
      endedAt: schema.conversations.endedAt,
      employeeName: schema.employees.name,
      employeeEmail: schema.employees.email,
      agentName: schema.agents.name,
      channelType: schema.channels.type,
    })
    .from(schema.conversations)
    .leftJoin(schema.employees, eq(schema.conversations.employeeId, schema.employees.id))
    .leftJoin(schema.agents, eq(schema.conversations.agentId, schema.agents.id))
    .leftJoin(schema.channels, eq(schema.conversations.channelId, schema.channels.id))
    .where(eq(schema.conversations.workspaceId, workspaceId))
    .orderBy(desc(schema.conversations.startedAt))
    .limit(limit);
}

export interface FullDashboardStats {
  // Operational
  activeAgents: number;
  conversationsToday: number;
  totalEmployees: number;
  avgDurationSeconds: number;
  activeTeams: number;
  // Usage / cost
  totalTokensMonth: number;
  totalTokensLastMonth: number;
  totalCostMonth: number;
  conversationsMonth: number;
  avgTokensPerConv: number;
  // Chart series
  activityByDay: { date: string; conversations: number; tokens: number }[];
  agentUsage: {
    id: string;
    name: string;
    model: string;
    conversations: number;
    tokens: number;
    costUsd: number;
    tokensPerConv: number;
  }[];
  channelDistribution: { type: string; count: number }[];
  statusDistribution: { status: string; count: number }[];
}

// Cost per 1K tokens (USD)
const MODEL_COST_PER_1K: Record<string, number> = {
  "claude-sonnet-4-6": 0.008,
  "claude-opus-4-7": 0.045,
  "claude-haiku-4-5": 0.001,
  "claude-haiku-4-5-20251001": 0.001,
};

export interface UsageStats {
  totalTokensMonth: number;
  totalTokensLastMonth: number;
  totalCostMonth: number;
  conversationsMonth: number;
  avgTokensPerConv: number;
  tokensByDay: { date: string; tokens: number }[];
  agentUsage: {
    id: string;
    name: string;
    model: string;
    conversations: number;
    tokens: number;
    costUsd: number;
  }[];
}

export async function getUsageStats(workspaceId: string): Promise<UsageStats> {
  const db = getDb();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const [tokenMonthResult, tokenLastMonthResult, convMonthResult, byDayResult, agentResult] =
    await Promise.all([
      // Total tokens this month
      db
        .select({ tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)` })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.messages.createdAt, startOfMonth)
        )),

      // Total tokens last month (for comparison)
      db
        .select({ tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)` })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.messages.createdAt, startOfLastMonth),
          sql`${schema.messages.createdAt} < ${startOfMonth}`
        )),

      // Conversations this month
      db
        .select({ value: count() })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, startOfMonth)
        )),

      // Tokens by day (last 30 days)
      db
        .select({
          date: sql<string>`date(${schema.messages.createdAt})`,
          tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)`,
        })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.messages.createdAt, thirtyDaysAgo)
        ))
        .groupBy(sql`date(${schema.messages.createdAt})`)
        .orderBy(sql`date(${schema.messages.createdAt})`),

      // Per-agent usage (all time, top 10)
      db
        .select({
          agentId: schema.agents.id,
          agentName: schema.agents.name,
          agentModel: schema.agents.model,
          conversations: countDistinct(schema.conversations.id),
          tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)`,
        })
        .from(schema.agents)
        .innerJoin(schema.conversations, eq(schema.conversations.agentId, schema.agents.id))
        .innerJoin(schema.messages, eq(schema.messages.conversationId, schema.conversations.id))
        .where(eq(schema.agents.workspaceId, workspaceId))
        .groupBy(schema.agents.id, schema.agents.name, schema.agents.model)
        .orderBy(desc(sql`sum(${schema.messages.tokensUsed})`))
        .limit(10),
    ]);

  const totalTokensMonth = Number(tokenMonthResult[0]?.tokens ?? 0);
  const totalTokensLastMonth = Number(tokenLastMonthResult[0]?.tokens ?? 0);
  const conversationsMonth = convMonthResult[0]?.value ?? 0;
  const avgTokensPerConv = conversationsMonth > 0
    ? Math.round(totalTokensMonth / conversationsMonth)
    : 0;

  const agentUsage = agentResult.map(r => {
    const tokens = Number(r.tokens);
    const costPer1k = MODEL_COST_PER_1K[r.agentModel] ?? 0.008;
    return {
      id: r.agentId,
      name: r.agentName,
      model: r.agentModel,
      conversations: r.conversations,
      tokens,
      costUsd: Math.round((tokens / 1000) * costPer1k * 100) / 100,
    };
  });

  const totalCostMonth = agentUsage.reduce((s, a) => {
    const costPer1k = MODEL_COST_PER_1K[a.model] ?? 0.008;
    return s + (a.tokens / 1000) * costPer1k;
  }, 0);

  return {
    totalTokensMonth,
    totalTokensLastMonth,
    totalCostMonth: Math.round(totalCostMonth * 100) / 100,
    conversationsMonth,
    avgTokensPerConv,
    tokensByDay: byDayResult.map(r => ({ date: r.date, tokens: Number(r.tokens) })),
    agentUsage,
  };
}

export async function getFullDashboardStats(workspaceId: string): Promise<FullDashboardStats> {
  const db = getDb();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    agentsResult, convsTodayResult, employeesResult, avgDurResult, teamsResult,
    tokMonthResult, tokLastMonthResult, convMonthResult,
    convsByDayResult, toksByDayResult,
    agentUsageResult, channelDistResult, statusDistResult,
  ] = await Promise.all([
    db.select({ value: count() }).from(schema.agents)
      .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.status, "active"))),

    db.select({ value: count() }).from(schema.conversations)
      .where(and(eq(schema.conversations.workspaceId, workspaceId), gte(schema.conversations.startedAt, today))),

    db.select({ value: count() }).from(schema.employees)
      .where(and(eq(schema.employees.workspaceId, workspaceId), eq(schema.employees.active, true))),

    db.select({ value: sql<number>`coalesce(avg(${schema.conversations.durationSeconds}), 0)` })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.workspaceId, workspaceId), gte(schema.conversations.startedAt, thirtyDaysAgo))),

    db.select({ value: count() }).from(schema.teams)
      .where(eq(schema.teams.workspaceId, workspaceId)),

    db.select({ tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)` })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
      .where(and(eq(schema.conversations.workspaceId, workspaceId), gte(schema.messages.createdAt, startOfMonth))),

    db.select({ tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)` })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
      .where(and(
        eq(schema.conversations.workspaceId, workspaceId),
        gte(schema.messages.createdAt, startOfLastMonth),
        sql`${schema.messages.createdAt} < ${startOfMonth}`,
      )),

    db.select({ value: count() }).from(schema.conversations)
      .where(and(eq(schema.conversations.workspaceId, workspaceId), gte(schema.conversations.startedAt, startOfMonth))),

    db.select({ date: sql<string>`date(${schema.conversations.startedAt})`, count: count() })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.workspaceId, workspaceId), gte(schema.conversations.startedAt, thirtyDaysAgo)))
      .groupBy(sql`date(${schema.conversations.startedAt})`),

    db.select({
      date: sql<string>`date(${schema.messages.createdAt})`,
      tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)`,
    })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
      .where(and(eq(schema.conversations.workspaceId, workspaceId), gte(schema.messages.createdAt, thirtyDaysAgo)))
      .groupBy(sql`date(${schema.messages.createdAt})`)
      .orderBy(sql`date(${schema.messages.createdAt})`),

    db.select({
      agentId: schema.agents.id,
      agentName: schema.agents.name,
      agentModel: schema.agents.model,
      conversations: countDistinct(schema.conversations.id),
      tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)`,
    })
      .from(schema.agents)
      .innerJoin(schema.conversations, eq(schema.conversations.agentId, schema.agents.id))
      .innerJoin(schema.messages, eq(schema.messages.conversationId, schema.conversations.id))
      .where(eq(schema.agents.workspaceId, workspaceId))
      .groupBy(schema.agents.id, schema.agents.name, schema.agents.model)
      .orderBy(desc(sql`sum(${schema.messages.tokensUsed})`))
      .limit(10),

    db.select({
      type: sql<string>`coalesce(${schema.channels.type}, 'direct')`,
      count: count(),
    })
      .from(schema.conversations)
      .leftJoin(schema.channels, eq(schema.conversations.channelId, schema.channels.id))
      .where(and(eq(schema.conversations.workspaceId, workspaceId), gte(schema.conversations.startedAt, thirtyDaysAgo)))
      .groupBy(schema.channels.type),

    db.select({ status: schema.conversations.status, count: count() })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.workspaceId, workspaceId), gte(schema.conversations.startedAt, thirtyDaysAgo)))
      .groupBy(schema.conversations.status),
  ]);

  // Merge conversations-per-day and tokens-per-day into unified activity series
  const convMap = new Map(convsByDayResult.map(r => [r.date, r.count]));
  const tokMap = new Map(toksByDayResult.map(r => [r.date, Number(r.tokens)]));
  const allDates = Array.from(new Set([...convMap.keys(), ...tokMap.keys()])).sort();
  const activityByDay = allDates.map(date => ({
    date,
    conversations: convMap.get(date) ?? 0,
    tokens: tokMap.get(date) ?? 0,
  }));

  const totalTokensMonth = Number(tokMonthResult[0]?.tokens ?? 0);
  const totalTokensLastMonth = Number(tokLastMonthResult[0]?.tokens ?? 0);
  const conversationsMonth = convMonthResult[0]?.value ?? 0;

  const agentUsage = agentUsageResult.map(r => {
    const tokens = Number(r.tokens);
    const costPer1k = MODEL_COST_PER_1K[r.agentModel] ?? 0.008;
    const convs = r.conversations;
    return {
      id: r.agentId,
      name: r.agentName,
      model: r.agentModel,
      conversations: convs,
      tokens,
      costUsd: Math.round((tokens / 1000) * costPer1k * 100) / 100,
      tokensPerConv: convs > 0 ? Math.round(tokens / convs) : 0,
    };
  });

  const totalCostMonth = agentUsage.reduce((s, a) => {
    const costPer1k = MODEL_COST_PER_1K[a.model] ?? 0.008;
    return s + (a.tokens / 1000) * costPer1k;
  }, 0);

  return {
    activeAgents: agentsResult[0]?.value ?? 0,
    conversationsToday: convsTodayResult[0]?.value ?? 0,
    totalEmployees: employeesResult[0]?.value ?? 0,
    avgDurationSeconds: Math.round(Number(avgDurResult[0]?.value ?? 0)),
    activeTeams: teamsResult[0]?.value ?? 0,
    totalTokensMonth,
    totalTokensLastMonth,
    totalCostMonth: Math.round(totalCostMonth * 100) / 100,
    conversationsMonth,
    avgTokensPerConv: conversationsMonth > 0 ? Math.round(totalTokensMonth / conversationsMonth) : 0,
    activityByDay,
    agentUsage,
    channelDistribution: channelDistResult.map(r => ({ type: r.type ?? "direct", count: r.count })),
    statusDistribution: statusDistResult.map(r => ({ status: r.status ?? "unknown", count: r.count })),
  };
}
