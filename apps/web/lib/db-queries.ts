import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, count, and, gte, sql, desc } from "drizzle-orm";

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
  const rows = await db
    .select({
      id: schema.teams.id,
      name: schema.teams.name,
      description: schema.teams.description,
      avatarColor: schema.teams.avatarColor,
      createdAt: schema.teams.createdAt,
    })
    .from(schema.teams)
    .where(eq(schema.teams.workspaceId, workspaceId));

  const agentCounts = await db
    .select({ teamId: schema.agents.teamId, count: count() })
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, workspaceId))
    .groupBy(schema.agents.teamId);

  const countMap = Object.fromEntries(
    agentCounts.map((r) => [r.teamId ?? "", r.count])
  );

  return rows.map((t) => ({ ...t, agentCount: countMap[t.id] ?? 0 }));
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
      teamId: schema.agents.teamId,
      teamName: schema.teams.name,
      createdAt: schema.agents.createdAt,
    })
    .from(schema.agents)
    .leftJoin(schema.teams, eq(schema.agents.teamId, schema.teams.id))
    .where(eq(schema.agents.workspaceId, workspaceId))
    .orderBy(desc(schema.agents.createdAt));
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
