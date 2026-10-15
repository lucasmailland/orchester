import "server-only";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, count, countDistinct, and, gte, lt, sql, desc } from "drizzle-orm";
import { usageSums } from "@/lib/usage-sql";

/**
 * Optional `tx?: WsDb` follows the project-wide pattern (see
 * `lib/billing/quotas.ts`). Dashboard server components that already
 * resolved a workspace context can wrap their reads in
 * `withWorkspaceTx` and thread `tx` so every aggregate runs on the
 * same connection that has `app.workspace_id` SET LOCAL — otherwise
 * each parallel `Promise.all` query races for a fresh pooled
 * connection without the GUC and FORCE RLS rejects them.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export interface DashboardStats {
  activeAgents: number;
  conversationsToday: number;
  totalEmployees: number;
  avgDurationSeconds: number;
  conversationsByDay: { date: string; count: number }[];
}

export async function getDashboardStats(workspaceId: string, tx?: WsDb): Promise<DashboardStats> {
  const db = tx ?? getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    activeAgentsResult,
    conversationsTodayResult,
    totalEmployeesResult,
    avgDurationResult,
    byDayResult,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.agents)
      .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.status, "active"))),

    db
      .select({ value: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, today)
        )
      ),

    db
      .select({ value: count() })
      .from(schema.employees)
      .where(and(eq(schema.employees.workspaceId, workspaceId), eq(schema.employees.active, true))),

    db
      .select({ value: sql<number>`coalesce(avg(${schema.conversations.durationSeconds}), 0)` })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      ),

    db
      .select({
        date: sql<string>`date(${schema.conversations.startedAt})`,
        count: count(),
      })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      )
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

export async function getTeams(workspaceId: string, tx?: WsDb) {
  const db = tx ?? getDb();
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

export async function getAgents(workspaceId: string, tx?: WsDb) {
  const db = tx ?? getDb();
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

export async function getTeamById(workspaceId: string, teamId: string, tx?: WsDb) {
  const db = tx ?? getDb();
  const [team] = await db
    .select()
    .from(schema.teams)
    .where(and(eq(schema.teams.id, teamId), eq(schema.teams.workspaceId, workspaceId)))
    .limit(1);
  return team ?? null;
}

export async function getTeamAgents(workspaceId: string, teamId: string, tx?: WsDb) {
  const db = tx ?? getDb();
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

export async function getTeamChannels(workspaceId: string, teamId: string, tx?: WsDb) {
  const db = tx ?? getDb();
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

export async function getEmployees(workspaceId: string, tx?: WsDb) {
  const db = tx ?? getDb();
  return db
    .select({
      id: schema.employees.id,
      name: schema.employees.name,
      email: schema.employees.email,
      phone: schema.employees.phone,
      area: schema.employees.area,
      active: schema.employees.active,
      monthlyBudgetUsd: schema.employees.monthlyBudgetUsd,
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

export async function getOrgData(workspaceId: string, tx?: WsDb): Promise<OrgTeam[]> {
  const db = tx ?? getDb();
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

export async function getConversations(workspaceId: string, limit = 50, tx?: WsDb) {
  const db = tx ?? getDb();
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

/** Model spend of a set of `usage_event` rows. */
export interface Spend {
  tokens: number;
  costUsd: number;
}

/**
 * The Command Center payload. Windows are UTC: "month" is the calendar month
 * of the reading instant, "30 days" ends at it.
 *
 * Tokens and cost come from `usage_event` only: one row per model call, with
 * its real price, whatever made it (channel turns, flow steps, the test chat,
 * the agent API, the MCP server, memory compaction, the prompt generator).
 * `message.tokens_used` is never added: the router writes it for the same
 * turn it writes a usage row for. Conversation counts come from
 * `conversation`.
 */
export interface FullDashboardStats {
  // Operational KPIs
  activeAgents: number;
  totalAgents: number;
  conversationsToday: number;
  conversationsYesterday: number;
  openConversations: number;
  escalatedCount: number;
  totalEmployees: number;
  avgDurationSeconds: number;
  activeTeams: number;
  // Model spend (usage_event) and conversations (conversation)
  totalTokensMonth: number;
  totalTokensLastMonth: number;
  totalCostMonth: number;
  totalCostLastMonth: number;
  conversationsMonth: number;
  conversationsLastMonth: number;
  /**
   * Conversation spend per conversation started this month. Conversation
   * spend is the router's turns plus the calls that name a conversation;
   * flow steps, the test chat and the like stay out.
   */
  avgTokensPerConv: number;
  avgCostPerConv: number;
  // Flows this month
  flowRunsMonth: number;
  flowRunsLastMonth: number;
  /** Every model call made for a flow, its agent steps included. */
  flowCostMonth: number;
  flowTokensMonth: number;
  // Chart series
  activityByDay: { date: string; conversations: number; tokens: number }[];
  /** This month's spend by agent, busiest first; at most `TOP_AGENTS`. */
  agentUsage: {
    id: string;
    name: string;
    model: string;
    status: string;
    conversations: number;
    tokens: number;
    costUsd: number;
    tokensPerConv: number;
  }[];
  /** This month's calls made for a flow without an agent (llm_prompt, media steps…). */
  flowStepUsage: Spend;
  /**
   * The rest of this month's spend, so that the agents, the flow steps and
   * this add up to the totals: calls with neither agent nor flow, agents
   * that no longer exist, and agents past the listed ones.
   */
  otherUsage: Spend;
  channelDistribution: { type: string; count: number }[];
  statusDistribution: { status: string; count: number }[];
  /** Last 30 days: conversations started with the team's agents, and their spend. */
  teamStats: {
    teamId: string;
    teamName: string;
    teamColor: string | null;
    conversations: number;
    tokens: number;
    costUsd: number;
  }[];
  // New: top employees by usage
  topEmployees: {
    id: string;
    name: string;
    email: string;
    area: string | null;
    conversations: number;
  }[];
  // New: hourly distribution (last 30d)
  hourlyDist: { hour: number; count: number }[];
  // New: recent conversations feed
  recentConversations: {
    id: string;
    employeeName: string | null;
    agentName: string | null;
    status: string;
    messageCount: number;
    durationSeconds: number | null;
    startedAt: Date;
    channelType: string | null;
  }[];
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

export async function getUsageStats(workspaceId: string, tx?: WsDb): Promise<UsageStats> {
  const db = tx ?? getDb();
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
        .innerJoin(
          schema.conversations,
          eq(schema.messages.conversationId, schema.conversations.id)
        )
        .where(
          and(
            eq(schema.conversations.workspaceId, workspaceId),
            gte(schema.messages.createdAt, startOfMonth)
          )
        ),

      // Total tokens last month (for comparison)
      db
        .select({ tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)` })
        .from(schema.messages)
        .innerJoin(
          schema.conversations,
          eq(schema.messages.conversationId, schema.conversations.id)
        )
        .where(
          and(
            eq(schema.conversations.workspaceId, workspaceId),
            gte(schema.messages.createdAt, startOfLastMonth),
            lt(schema.messages.createdAt, startOfMonth)
          )
        ),

      // Conversations this month
      db
        .select({ value: count() })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.workspaceId, workspaceId),
            gte(schema.conversations.startedAt, startOfMonth)
          )
        ),

      // Tokens by day (last 30 days)
      db
        .select({
          date: sql<string>`date(${schema.messages.createdAt})`,
          tokens: sql<number>`coalesce(sum(${schema.messages.tokensUsed}), 0)`,
        })
        .from(schema.messages)
        .innerJoin(
          schema.conversations,
          eq(schema.messages.conversationId, schema.conversations.id)
        )
        .where(
          and(
            eq(schema.conversations.workspaceId, workspaceId),
            gte(schema.messages.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(sql`date(${schema.messages.createdAt})`)
        .orderBy(sql`date(${schema.messages.createdAt})`),

      // Per-agent usage (current month, top 10) — alineado con totalTokensMonth
      // y totalCostMonth para evitar incoherencias en los KPI cards.
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
        .where(
          and(
            eq(schema.agents.workspaceId, workspaceId),
            gte(schema.messages.createdAt, startOfMonth)
          )
        )
        .groupBy(schema.agents.id, schema.agents.name, schema.agents.model)
        .orderBy(desc(sql`sum(${schema.messages.tokensUsed})`))
        .limit(10),
    ]);

  const totalTokensMonth = Number(tokenMonthResult[0]?.tokens ?? 0);
  const totalTokensLastMonth = Number(tokenLastMonthResult[0]?.tokens ?? 0);
  const conversationsMonth = convMonthResult[0]?.value ?? 0;
  const avgTokensPerConv =
    conversationsMonth > 0 ? Math.round(totalTokensMonth / conversationsMonth) : 0;

  const agentUsage = agentResult.map((r) => {
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
    tokensByDay: byDayResult.map((r) => ({ date: r.date, tokens: Number(r.tokens) })),
    agentUsage,
  };
}

/** Agents `getFullDashboardStats` lists by name; the rest goes to `otherUsage`. */
const TOP_AGENTS = 12;

/** Rounds dollars to the precision `cost_usd` is stored with. */
function usd(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Tokens and cost of the `usage_event` rows a select covers. */
function spendColumns() {
  const sums = usageSums();
  return { tokens: sums.tokensTotal, costUsd: sums.costUsd };
}

/*
 * How a model call is classified. Both expressions are grouped by, so they
 * hold no bind parameters: Postgres matches GROUP BY to the select list by
 * text, and a parameter would get a different number in each place.
 */
/** The call was made for a flow (any step, the flow copilot). */
const forFlow = () => sql<boolean>`(${schema.usageEvents.flowId} IS NOT NULL)`;
/** The call belongs to a conversation: a router turn, or a call that names one. */
const ofConversation = () =>
  sql<boolean>`(${schema.usageEvents.kind} = 'agent_message' OR ${schema.usageEvents.metadata} ->> 'conversationId' IS NOT NULL)`;

interface SpendGroup {
  agentId: string | null;
  forFlow: boolean;
  ofConversation: boolean;
  tokens: number;
  costUsd: number;
}

interface AgentRef {
  id: string;
  name: string;
  model: string;
  status: string;
}

/** This month's spend, folded from rows grouped by agent, flow and conversation. */
function foldMonthSpend(
  groups: SpendGroup[],
  agents: AgentRef[],
  conversationsByAgent: Map<string, number>,
  conversationsMonth: number
) {
  const total = { tokens: 0, costUsd: 0 };
  const flows = { tokens: 0, costUsd: 0 };
  const flowSteps = { tokens: 0, costUsd: 0 };
  const conversations = { tokens: 0, costUsd: 0 };
  const byAgent = new Map<string, { tokens: number; costUsd: number; convTokens: number }>();
  const add = (into: Spend, tokens: number, costUsd: number) => {
    into.tokens += tokens;
    into.costUsd += costUsd;
  };

  for (const g of groups) {
    const tokens = Number(g.tokens);
    const costUsd = Number(g.costUsd);
    add(total, tokens, costUsd);
    if (g.forFlow) add(flows, tokens, costUsd);
    if (g.ofConversation) add(conversations, tokens, costUsd);
    if (g.agentId) {
      let agent = byAgent.get(g.agentId);
      if (!agent) byAgent.set(g.agentId, (agent = { tokens: 0, costUsd: 0, convTokens: 0 }));
      add(agent, tokens, costUsd);
      if (g.ofConversation) agent.convTokens += tokens;
    } else if (g.forFlow) {
      add(flowSteps, tokens, costUsd);
    }
  }

  const agentUsage = agents
    .map((a) => {
      const spend = byAgent.get(a.id);
      const convs = conversationsByAgent.get(a.id) ?? 0;
      return {
        ...a,
        conversations: convs,
        tokens: spend?.tokens ?? 0,
        costUsd: spend?.costUsd ?? 0,
        tokensPerConv: convs > 0 ? Math.round((spend?.convTokens ?? 0) / convs) : 0,
      };
    })
    .filter((a) => a.tokens > 0 || a.costUsd > 0 || a.conversations > 0)
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        b.costUsd - a.costUsd ||
        b.conversations - a.conversations ||
        a.name.localeCompare(b.name)
    )
    .slice(0, TOP_AGENTS);

  const listed = { tokens: flowSteps.tokens, costUsd: flowSteps.costUsd };
  for (const a of agentUsage) add(listed, a.tokens, a.costUsd);

  return {
    totalTokensMonth: Math.round(total.tokens),
    totalCostMonth: usd(total.costUsd),
    avgTokensPerConv:
      conversationsMonth > 0 ? Math.round(conversations.tokens / conversationsMonth) : 0,
    avgCostPerConv: conversationsMonth > 0 ? usd(conversations.costUsd / conversationsMonth) : 0,
    flowCostMonth: usd(flows.costUsd),
    flowTokensMonth: Math.round(flows.tokens),
    agentUsage: agentUsage.map((a) => ({
      ...a,
      tokens: Math.round(a.tokens),
      costUsd: usd(a.costUsd),
    })),
    flowStepUsage: { tokens: Math.round(flowSteps.tokens), costUsd: usd(flowSteps.costUsd) },
    otherUsage: {
      tokens: Math.max(0, Math.round(total.tokens - listed.tokens)),
      costUsd: Math.max(0, usd(total.costUsd - listed.costUsd)),
    },
  };
}

/** Team rows of the last 30 days: conversations and spend, read apart and merged. */
function mergeTeamStats(
  conversations: {
    teamId: string;
    teamName: string;
    teamColor: string | null;
    conversations: number;
  }[],
  spend: {
    teamId: string;
    teamName: string;
    teamColor: string | null;
    tokens: number;
    costUsd: number;
  }[]
): FullDashboardStats["teamStats"] {
  const teams = new Map<string, FullDashboardStats["teamStats"][number]>();
  const team = (r: { teamId: string; teamName: string; teamColor: string | null }) => {
    let row = teams.get(r.teamId);
    if (!row) {
      row = {
        teamId: r.teamId,
        teamName: r.teamName,
        teamColor: r.teamColor,
        conversations: 0,
        tokens: 0,
        costUsd: 0,
      };
      teams.set(r.teamId, row);
    }
    return row;
  };
  for (const r of conversations) team(r).conversations += Number(r.conversations);
  for (const r of spend) {
    const row = team(r);
    row.tokens += Math.round(Number(r.tokens));
    row.costUsd = usd(row.costUsd + Number(r.costUsd));
  }
  return [...teams.values()].sort(
    (a, b) =>
      b.conversations - a.conversations ||
      b.costUsd - a.costUsd ||
      a.teamName.localeCompare(b.teamName)
  );
}

/**
 * Everything the Command Center shows, read at `opts.now` (default: the
 * clock). Every query names the workspace; the page runs it inside
 * `withWorkspaceTx` so RLS confines it too.
 */
export async function getFullDashboardStats(
  workspaceId: string,
  tx?: WsDb,
  opts: { now?: Date } = {}
): Promise<FullDashboardStats> {
  const db = tx ?? getDb();
  const now = opts.now ?? new Date();
  // Build all boundary dates using Date.UTC so they're UTC-anchored Date objects
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - 86_400_000);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ue = schema.usageEvents;

  const [
    activeAgentsRes,
    totalAgentsRes,
    convsTodayRes,
    convsYesterdayRes,
    employeesRes,
    avgDurRes,
    teamsRes,
    openConvsRes,
    escalatedRes,
    spendMonthRes,
    spendLastMonthRes,
    convMonthRes,
    convLastMonthRes,
    convsByDayRes,
    toksByDayRes,
    agentsRes,
    convsByAgentRes,
    flowRunsMonthRes,
    flowRunsLastMonthRes,
    channelDistRes,
    statusDistRes,
    topEmployeesRes,
    teamConvsRes,
    teamSpendRes,
    hourlyRes,
    recentConvsRes,
  ] = await Promise.all([
    // Active agents
    db
      .select({ value: count() })
      .from(schema.agents)
      .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.status, "active"))),

    // Total agents
    db
      .select({ value: count() })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId)),

    // Conversations today
    db
      .select({ value: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, today)
        )
      ),

    // Conversations yesterday
    db
      .select({ value: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, yesterday),
          lt(schema.conversations.startedAt, today)
        )
      ),

    // Total employees
    db
      .select({ value: count() })
      .from(schema.employees)
      .where(and(eq(schema.employees.workspaceId, workspaceId), eq(schema.employees.active, true))),

    // Average duration (30d)
    db
      .select({ value: sql<number>`coalesce(avg(${schema.conversations.durationSeconds}), 0)` })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      ),

    // Teams count
    db
      .select({ value: count() })
      .from(schema.teams)
      .where(eq(schema.teams.workspaceId, workspaceId)),

    // Open conversations
    db
      .select({ value: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          eq(schema.conversations.status, "open")
        )
      ),

    // Escalated this month
    db
      .select({ value: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          eq(schema.conversations.status, "escalated"),
          gte(schema.conversations.startedAt, startOfMonth)
        )
      ),

    // Model spend this month, by agent / for a flow / of a conversation
    db
      .select({
        agentId: ue.agentId,
        forFlow: forFlow(),
        ofConversation: ofConversation(),
        ...spendColumns(),
      })
      .from(ue)
      .where(and(eq(ue.workspaceId, workspaceId), gte(ue.createdAt, startOfMonth)))
      .groupBy(ue.agentId, forFlow(), ofConversation()),

    // Model spend last month
    db
      .select(spendColumns())
      .from(ue)
      .where(
        and(
          eq(ue.workspaceId, workspaceId),
          gte(ue.createdAt, startOfLastMonth),
          lt(ue.createdAt, startOfMonth)
        )
      ),

    // Conversations this month
    db
      .select({ value: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, startOfMonth)
        )
      ),

    // Conversations last month
    db
      .select({ value: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, startOfLastMonth),
          lt(schema.conversations.startedAt, startOfMonth)
        )
      ),

    // Conversations by day (30d)
    db
      .select({ date: sql<string>`date(${schema.conversations.startedAt})`, count: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      )
      .groupBy(sql`date(${schema.conversations.startedAt})`),

    // Tokens by day (30d)
    db
      .select({ date: sql<string>`date(${ue.createdAt})`, tokens: spendColumns().tokens })
      .from(ue)
      .where(and(eq(ue.workspaceId, workspaceId), gte(ue.createdAt, thirtyDaysAgo)))
      .groupBy(sql`date(${ue.createdAt})`),

    // The workspace's agents, to name the spend
    db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        model: schema.agents.model,
        status: schema.agents.status,
      })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId)),

    // Conversations this month by agent
    db
      .select({ agentId: schema.conversations.agentId, count: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, startOfMonth)
        )
      )
      .groupBy(schema.conversations.agentId),

    // Flow runs this month
    db
      .select({ value: count() })
      .from(schema.flowRuns)
      .where(
        and(
          eq(schema.flowRuns.workspaceId, workspaceId),
          gte(schema.flowRuns.startedAt, startOfMonth)
        )
      ),

    // Flow runs last month
    db
      .select({ value: count() })
      .from(schema.flowRuns)
      .where(
        and(
          eq(schema.flowRuns.workspaceId, workspaceId),
          gte(schema.flowRuns.startedAt, startOfLastMonth),
          lt(schema.flowRuns.startedAt, startOfMonth)
        )
      ),

    // Channel distribution (30d)
    db
      .select({
        type: sql<string>`coalesce(${schema.channels.type}::text, 'unknown')`,
        count: count(),
      })
      .from(schema.conversations)
      .leftJoin(
        schema.channels,
        and(
          eq(schema.conversations.channelId, schema.channels.id),
          eq(schema.channels.workspaceId, workspaceId)
        )
      )
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      )
      .groupBy(sql`coalesce(${schema.channels.type}::text, 'unknown')`),

    // Status distribution (30d)
    db
      .select({ status: schema.conversations.status, count: count() })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      )
      .groupBy(schema.conversations.status),

    // Top employees by conversation count (30d)
    db
      .select({
        id: schema.employees.id,
        name: schema.employees.name,
        email: schema.employees.email,
        area: schema.employees.area,
        conversations: count(),
      })
      .from(schema.conversations)
      .innerJoin(
        schema.employees,
        and(
          eq(schema.conversations.employeeId, schema.employees.id),
          eq(schema.employees.workspaceId, workspaceId)
        )
      )
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      )
      .groupBy(
        schema.employees.id,
        schema.employees.name,
        schema.employees.email,
        schema.employees.area
      )
      .orderBy(desc(count()))
      .limit(8),

    // Team conversations (30d)
    db
      .select({
        teamId: schema.teams.id,
        teamName: schema.teams.name,
        teamColor: schema.teams.avatarColor,
        conversations: count(),
      })
      .from(schema.conversations)
      .innerJoin(schema.agents, eq(schema.conversations.agentId, schema.agents.id))
      .innerJoin(schema.teams, eq(schema.agents.teamId, schema.teams.id))
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          eq(schema.agents.workspaceId, workspaceId),
          eq(schema.teams.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      )
      .groupBy(schema.teams.id, schema.teams.name, schema.teams.avatarColor),

    // Team spend (30d): the model calls of the team's agents
    db
      .select({
        teamId: schema.teams.id,
        teamName: schema.teams.name,
        teamColor: schema.teams.avatarColor,
        ...spendColumns(),
      })
      .from(ue)
      .innerJoin(schema.agents, eq(ue.agentId, schema.agents.id))
      .innerJoin(schema.teams, eq(schema.agents.teamId, schema.teams.id))
      .where(
        and(
          eq(ue.workspaceId, workspaceId),
          eq(schema.agents.workspaceId, workspaceId),
          eq(schema.teams.workspaceId, workspaceId),
          gte(ue.createdAt, thirtyDaysAgo)
        )
      )
      .groupBy(schema.teams.id, schema.teams.name, schema.teams.avatarColor),

    // Hourly distribution (last 30d) – hour of day 0-23
    db
      .select({
        hour: sql<number>`extract(hour from ${schema.conversations.startedAt})::int`,
        count: count(),
      })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )
      )
      .groupBy(sql`extract(hour from ${schema.conversations.startedAt})`)
      .orderBy(sql`extract(hour from ${schema.conversations.startedAt})`),

    // Recent conversations (last 10)
    db
      .select({
        id: schema.conversations.id,
        status: schema.conversations.status,
        messageCount: schema.conversations.messageCount,
        durationSeconds: schema.conversations.durationSeconds,
        startedAt: schema.conversations.startedAt,
        employeeName: schema.employees.name,
        agentName: schema.agents.name,
        channelType: schema.channels.type,
      })
      .from(schema.conversations)
      .leftJoin(
        schema.employees,
        and(
          eq(schema.conversations.employeeId, schema.employees.id),
          eq(schema.employees.workspaceId, workspaceId)
        )
      )
      .leftJoin(
        schema.agents,
        and(
          eq(schema.conversations.agentId, schema.agents.id),
          eq(schema.agents.workspaceId, workspaceId)
        )
      )
      .leftJoin(
        schema.channels,
        and(
          eq(schema.conversations.channelId, schema.channels.id),
          eq(schema.channels.workspaceId, workspaceId)
        )
      )
      .where(eq(schema.conversations.workspaceId, workspaceId))
      .orderBy(desc(schema.conversations.startedAt))
      .limit(10),
  ]);

  // Merge activity series
  const convMap = new Map(convsByDayRes.map((r) => [r.date, r.count]));
  const tokMap = new Map(toksByDayRes.map((r) => [r.date, Math.round(Number(r.tokens))]));
  const allDates = Array.from(new Set([...convMap.keys(), ...tokMap.keys()])).sort();
  const activityByDay = allDates.map((date) => ({
    date,
    conversations: convMap.get(date) ?? 0,
    tokens: tokMap.get(date) ?? 0,
  }));

  const conversationsMonth = convMonthRes[0]?.value ?? 0;
  const conversationsLastMonth = convLastMonthRes[0]?.value ?? 0;
  const conversationsByAgent = new Map(
    convsByAgentRes.flatMap((r) => (r.agentId ? [[r.agentId, r.count] as const] : []))
  );
  const monthSpend = foldMonthSpend(
    spendMonthRes,
    agentsRes,
    conversationsByAgent,
    conversationsMonth
  );
  const lastMonthSpend = spendLastMonthRes[0];

  // Fill hourly array: 0-23 with zeros for missing hours
  const hourMap = new Map(hourlyRes.map((r) => [r.hour, r.count]));
  const hourlyDist = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: hourMap.get(h) ?? 0,
  }));

  return {
    activeAgents: activeAgentsRes[0]?.value ?? 0,
    totalAgents: totalAgentsRes[0]?.value ?? 0,
    conversationsToday: convsTodayRes[0]?.value ?? 0,
    conversationsYesterday: convsYesterdayRes[0]?.value ?? 0,
    openConversations: openConvsRes[0]?.value ?? 0,
    escalatedCount: escalatedRes[0]?.value ?? 0,
    totalEmployees: employeesRes[0]?.value ?? 0,
    avgDurationSeconds: Math.round(Number(avgDurRes[0]?.value ?? 0)),
    activeTeams: teamsRes[0]?.value ?? 0,
    totalTokensMonth: monthSpend.totalTokensMonth,
    totalTokensLastMonth: Math.round(Number(lastMonthSpend?.tokens ?? 0)),
    totalCostMonth: monthSpend.totalCostMonth,
    totalCostLastMonth: usd(Number(lastMonthSpend?.costUsd ?? 0)),
    conversationsMonth,
    conversationsLastMonth,
    avgTokensPerConv: monthSpend.avgTokensPerConv,
    avgCostPerConv: monthSpend.avgCostPerConv,
    flowRunsMonth: flowRunsMonthRes[0]?.value ?? 0,
    flowRunsLastMonth: flowRunsLastMonthRes[0]?.value ?? 0,
    flowCostMonth: monthSpend.flowCostMonth,
    flowTokensMonth: monthSpend.flowTokensMonth,
    activityByDay,
    agentUsage: monthSpend.agentUsage,
    flowStepUsage: monthSpend.flowStepUsage,
    otherUsage: monthSpend.otherUsage,
    channelDistribution: channelDistRes.map((r) => ({ type: r.type ?? "direct", count: r.count })),
    statusDistribution: statusDistRes.map((r) => ({
      status: r.status ?? "unknown",
      count: r.count,
    })),
    teamStats: mergeTeamStats(teamConvsRes, teamSpendRes),
    topEmployees: topEmployeesRes.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      area: r.area ?? null,
      conversations: r.conversations,
    })),
    hourlyDist,
    recentConversations: recentConvsRes.map((r) => ({
      id: r.id,
      employeeName: r.employeeName ?? null,
      agentName: r.agentName ?? null,
      status: r.status,
      messageCount: r.messageCount ?? 0,
      durationSeconds: r.durationSeconds ?? null,
      startedAt: r.startedAt,
      channelType: r.channelType ?? null,
    })),
  };
}

/**
 * Phase L.1 onboarding checklist state.
 *
 * A snapshot of 5 booleans that drive the first-run checklist on the
 * dashboard. Each flag flips to `true` the moment the corresponding
 * resource exists for this workspace; once all five are `true` the
 * dashboard hides the checklist (or shows a "workspace ready" banner
 * the operator can dismiss permanently via localStorage).
 *
 * The flags are read-only — no caller mutates them. They reflect
 * what's actually in the DB right now, so a row arriving from any
 * source (the wizard, the seed script, a direct API call) updates the
 * checklist on the next request without any extra plumbing.
 */
export interface OnboardingChecklistState {
  hasAgent: boolean;
  hasProvider: boolean;
  hasChannel: boolean;
  hasTeammate: boolean;
  hasActivity: boolean;
}

export async function getOnboardingChecklistState(
  workspaceId: string,
  tx?: WsDb
): Promise<OnboardingChecklistState> {
  const db = tx ?? getDb();

  // Each LIMIT 1 keeps the round-trips cheap — we only need to know
  // whether the table has ≥1 (or ≥2 for members) row for this workspace.
  // Drizzle's `count()` would force a full table scan under RLS; the
  // `select … limit 1` shape lets postgres short-circuit on the first
  // hit, which matters when a busy workspace has thousands of rows.
  const [agentRows, providerRows, channelRows, memberRows, convRows, flowRunRows] =
    await Promise.all([
      db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(eq(schema.agents.workspaceId, workspaceId))
        .limit(1),
      db
        .select({ id: schema.aiProviders.id })
        .from(schema.aiProviders)
        .where(eq(schema.aiProviders.workspaceId, workspaceId))
        .limit(1),
      db
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .where(eq(schema.channels.workspaceId, workspaceId))
        .limit(1),
      // Teammate = ≥2 members (owner + at least one other). Pulling 2
      // rows is enough to discriminate without a full count().
      db
        .select({ id: schema.workspaceMembers.id })
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.workspaceId, workspaceId))
        .limit(2),
      db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId))
        .limit(1),
      db
        .select({ id: schema.flowRuns.id })
        .from(schema.flowRuns)
        .where(eq(schema.flowRuns.workspaceId, workspaceId))
        .limit(1),
    ]);

  return {
    hasAgent: agentRows.length > 0,
    hasProvider: providerRows.length > 0,
    hasChannel: channelRows.length > 0,
    hasTeammate: memberRows.length >= 2,
    hasActivity: convRows.length > 0 || flowRunRows.length > 0,
  };
}
