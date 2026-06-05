import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, desc, eq, gte, like, or, sql } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

/**
 * GET /api/conversations?
 *   status=open|closed|escalated
 *   channel=widget|telegram|...
 *   agentId=...
 *   tag=...
 *   search=...
 *   from=ISO
 *   limit=50
 */
export async function GET(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const channelType = url.searchParams.get("channel");
  const agentId = url.searchParams.get("agentId");
  const tag = url.searchParams.get("tag");
  const search = url.searchParams.get("search");
  const fromIso = url.searchParams.get("from");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

  const db = getDb();

  const conds = [eq(schema.conversations.workspaceId, ws.workspace.id)];
  if (status)
    conds.push(eq(schema.conversations.status, status as "open" | "closed" | "escalated"));
  if (agentId) conds.push(eq(schema.conversations.agentId, agentId));
  if (fromIso) conds.push(gte(schema.conversations.startedAt, new Date(fromIso)));
  if (tag) {
    // jsonb @> '["tag"]'
    conds.push(sql`${schema.conversations.tags} @> ${JSON.stringify([tag])}::jsonb`);
  }
  if (search) {
    conds.push(
      or(
        like(schema.conversations.summary, `%${search}%`),
        like(schema.conversations.customerName, `%${search}%`),
        like(schema.conversations.customerEmail, `%${search}%`)
      )!
    );
  }

  // Join with channels (filtro por tipo + nombre), employees (nombre del usuario
  // real cuando la conversación está atada a un empleado) y agents (nombre del
  // agente que respondió). Esto evita el "Anónimo · sin agente" del listado.
  const rows = await db
    .select({
      id: schema.conversations.id,
      status: schema.conversations.status,
      channelType: schema.channels.type,
      channelName: schema.channels.name,
      agentId: schema.conversations.agentId,
      agentName: schema.agents.name,
      employeeName: schema.employees.name,
      employeeEmail: schema.employees.email,
      customerName: schema.conversations.customerName,
      customerEmail: schema.conversations.customerEmail,
      tags: schema.conversations.tags,
      csat: schema.conversations.csat,
      messageCount: schema.conversations.messageCount,
      startedAt: schema.conversations.startedAt,
      takenOverAt: schema.conversations.takenOverAt,
      summary: schema.conversations.summary,
      totalCostUsd: schema.conversations.totalCostUsd,
      totalTokens: schema.conversations.totalTokens,
    })
    .from(schema.conversations)
    .leftJoin(schema.channels, eq(schema.channels.id, schema.conversations.channelId))
    .leftJoin(schema.employees, eq(schema.employees.id, schema.conversations.employeeId))
    .leftJoin(schema.agents, eq(schema.agents.id, schema.conversations.agentId))
    .where(
      channelType ? and(...conds, eq(schema.channels.type, channelType as never)) : and(...conds)
    )
    .orderBy(desc(schema.conversations.startedAt))
    .limit(limit + 1) // +1 para detectar si hay más; lo descartamos al responder
    .offset(offset);

  const hasMore = rows.length > limit;
  return NextResponse.json({
    rows: hasMore ? rows.slice(0, limit) : rows,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  });
}
