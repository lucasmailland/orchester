import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

interface OrgNode {
  id: string;
  type: "team" | "agent" | "employee" | "flow";
  label: string;
  meta?: Record<string, unknown>;
}
interface OrgEdge {
  id: string;
  source: string;
  target: string;
  kind: "team-agent" | "employee-agent" | "flow-agent" | "team-employee";
}

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const wsId = ws.workspace.id;

  const [teams, agents, employees, flows, runs] = await Promise.all([
    db.select().from(schema.teams).where(eq(schema.teams.workspaceId, wsId)),
    db.select().from(schema.agents).where(eq(schema.agents.workspaceId, wsId)),
    db.select().from(schema.employees).where(eq(schema.employees.workspaceId, wsId)),
    db.select().from(schema.flows).where(eq(schema.flows.workspaceId, wsId)),
    db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.workspaceId, wsId))
      .orderBy(desc(schema.flowRuns.startedAt))
      .limit(50),
  ]);

  const recentActiveFlowIds = new Set(
    runs.filter((r) => r.status === "running" || r.status === "succeeded").map((r) => r.flowId)
  );

  const nodes: OrgNode[] = [];
  const edges: OrgEdge[] = [];

  for (const t of teams) {
    nodes.push({
      id: `team:${t.id}`,
      type: "team",
      label: t.name,
      meta: { color: t.avatarColor },
    });
  }
  for (const a of agents) {
    nodes.push({
      id: `agent:${a.id}`,
      type: "agent",
      label: a.name,
      meta: { role: a.role, model: a.model, status: a.status },
    });
    if (a.teamId) {
      edges.push({
        id: `e:t-a:${a.id}`,
        source: `team:${a.teamId}`,
        target: `agent:${a.id}`,
        kind: "team-agent",
      });
    }
  }
  for (const e of employees) {
    nodes.push({
      id: `employee:${e.id}`,
      type: "employee",
      label: e.name,
      meta: { area: e.area, email: e.email },
    });
    for (const aid of e.assignedAgentIds ?? []) {
      edges.push({
        id: `e:em-a:${e.id}-${aid}`,
        source: `employee:${e.id}`,
        target: `agent:${aid}`,
        kind: "employee-agent",
      });
    }
  }
  for (const f of flows) {
    nodes.push({
      id: `flow:${f.id}`,
      type: "flow",
      label: f.name,
      meta: { active: recentActiveFlowIds.has(f.id), status: f.status },
    });
    const agentIdsInFlow = new Set<string>();
    for (const n of (f.nodes ?? []) as Array<{
      type: string;
      config?: Record<string, unknown>;
    }>) {
      if (n.type === "agent" && typeof n.config?.agentId === "string") {
        agentIdsInFlow.add(n.config.agentId);
      }
    }
    for (const aid of agentIdsInFlow) {
      edges.push({
        id: `e:f-a:${f.id}-${aid}`,
        source: `flow:${f.id}`,
        target: `agent:${aid}`,
        kind: "flow-agent",
      });
    }
  }

  return NextResponse.json({ nodes, edges });
}
