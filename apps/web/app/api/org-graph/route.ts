import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

/**
 * Organigrama de IA — sólo Workspace → Teams → Agents, con Flows
 * que conectan agentes entre sí. Sin empleados (la idea es agentizar).
 */

export type OrgNodeType = "workspace" | "team" | "agent" | "flow";

interface OrgNode {
  id: string;
  type: OrgNodeType;
  label: string;
  meta?: Record<string, unknown>;
}
interface OrgEdge {
  id: string;
  source: string;
  target: string;
  kind: "ws-team" | "team-agent" | "flow-agent" | "agent-agent";
  animated?: boolean;
  label?: string;
}

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const wsId = ws.workspace.id;

  const [teams, agents, flows, runs, channels] = await Promise.all([
    db.select().from(schema.teams).where(eq(schema.teams.workspaceId, wsId)),
    db.select().from(schema.agents).where(eq(schema.agents.workspaceId, wsId)),
    db.select().from(schema.flows).where(eq(schema.flows.workspaceId, wsId)),
    db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.workspaceId, wsId))
      .orderBy(desc(schema.flowRuns.startedAt))
      .limit(50),
    db.select().from(schema.channels).where(eq(schema.channels.workspaceId, wsId)),
  ]);

  // Compute "live" flows (had a run in the last few min)
  const liveCutoff = Date.now() - 10 * 60 * 1000;
  const liveFlowIds = new Set(
    runs
      .filter((r) => r.status === "running" || r.status === "succeeded")
      .filter((r) => new Date(r.startedAt).getTime() > liveCutoff)
      .map((r) => r.flowId)
  );

  const nodes: OrgNode[] = [];
  const edges: OrgEdge[] = [];

  // Root workspace node
  const wsNodeId = `workspace:${wsId}`;
  nodes.push({
    id: wsNodeId,
    type: "workspace",
    label: ws.workspace.name,
    meta: {
      teamCount: teams.length,
      agentCount: agents.length,
      flowCount: flows.length,
    },
  });

  // Group agents by team
  const agentsByTeam = new Map<string, typeof agents>();
  const orphanAgents: typeof agents = [];
  for (const a of agents) {
    if (a.teamId) {
      if (!agentsByTeam.has(a.teamId)) agentsByTeam.set(a.teamId, []);
      agentsByTeam.get(a.teamId)!.push(a);
    } else {
      orphanAgents.push(a);
    }
  }

  // Teams + connections to workspace
  for (const t of teams) {
    const teamAgents = agentsByTeam.get(t.id) ?? [];
    const activeCount = teamAgents.filter((a) => a.status === "active").length;
    nodes.push({
      id: `team:${t.id}`,
      type: "team",
      label: t.name,
      meta: {
        color: t.avatarColor,
        agentCount: teamAgents.length,
        activeCount,
        description: t.description,
      },
    });
    edges.push({
      id: `e:ws-t:${t.id}`,
      source: wsNodeId,
      target: `team:${t.id}`,
      kind: "ws-team",
    });
  }

  // Synthetic team for orphan agents (sin equipo asignado)
  const orphanTeamId = "team:__orphan__";
  if (orphanAgents.length > 0) {
    nodes.push({
      id: orphanTeamId,
      type: "team",
      label: "Sin equipo",
      meta: {
        color: "#52525b",
        agentCount: orphanAgents.length,
        activeCount: orphanAgents.filter((a) => a.status === "active").length,
        description: "Agentes sin equipo asignado",
        orphan: true,
      },
    });
    edges.push({
      id: "e:ws-orphan",
      source: wsNodeId,
      target: orphanTeamId,
      kind: "ws-team",
    });
  }

  // Channels per agent (so agents show their reach)
  const channelsByAgent = new Map<string, Array<{ id: string; type: string; name: string }>>();
  for (const c of channels) {
    if (c.agentId) {
      if (!channelsByAgent.has(c.agentId)) channelsByAgent.set(c.agentId, []);
      channelsByAgent.get(c.agentId)!.push({ id: c.id, type: c.type, name: c.name });
    }
  }

  // Agents + connections to their team
  for (const a of agents) {
    const parentTeamId = a.teamId ? `team:${a.teamId}` : orphanTeamId;
    nodes.push({
      id: `agent:${a.id}`,
      type: "agent",
      label: a.name,
      meta: {
        role: a.role,
        model: a.model,
        status: a.status,
        kind: a.kind,
        color: a.color,
        toolCount: (a.tools as string[] | null)?.length ?? 0,
        channels: channelsByAgent.get(a.id) ?? [],
      },
    });
    edges.push({
      id: `e:t-a:${a.id}`,
      source: parentTeamId,
      target: `agent:${a.id}`,
      kind: "team-agent",
    });
  }

  // Flows are NOT rendered as separate nodes. Instead each flow that chains
  // multiple agents creates an agent→agent edge labeled with the flow name —
  // so the user reads relationships naturally ("Lead Qualifier orquesta hacia
  // Closer Bot via Pipeline de leads"). One node, two relations.
  for (const f of flows) {
    const flowNodes = (f.nodes ?? []) as Array<{
      id: string;
      type: string;
      config?: Record<string, unknown>;
    }>;
    const agentRefs: string[] = [];
    for (const n of flowNodes) {
      if (n.type === "agent" && typeof n.config?.agentId === "string") {
        agentRefs.push(n.config.agentId);
      }
    }
    if (agentRefs.length === 0) continue;

    // Show the agent-to-agent chain inside the flow as direct edges
    for (let i = 0; i < agentRefs.length - 1; i++) {
      const a = agentRefs[i]!;
      const b = agentRefs[i + 1]!;
      if (a === b) continue;
      edges.push({
        id: `e:a-a:${f.id}-${i}`,
        source: `agent:${a}`,
        target: `agent:${b}`,
        kind: "agent-agent",
        animated: liveFlowIds.has(f.id),
        label: f.name,
      });
    }
  }

  return NextResponse.json({
    nodes,
    edges,
    summary: {
      teams: teams.length,
      agents: agents.length,
      activeAgents: agents.filter((a) => a.status === "active").length,
      flows: flows.length,
      liveFlows: liveFlowIds.size,
    },
  });
}
