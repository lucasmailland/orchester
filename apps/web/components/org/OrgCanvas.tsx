"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, Workflow, Layers, Building2, Search, Zap, Wrench, Radio } from "lucide-react";
import { useRouter, useParams } from "next/navigation";

interface OrgNode {
  id: string;
  type: "workspace" | "team" | "agent" | "flow";
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

interface Summary {
  teams: number;
  agents: number;
  activeAgents: number;
  flows: number;
  liveFlows: number;
}

const COLORS = {
  workspace: "#a78bfa",
  team: "#3b82f6",
  agent: "#8b5cf6",
  flow: "#f59e0b",
};

const EDGE_COLORS: Record<string, string> = {
  "ws-team": "#3b82f6",
  "team-agent": "#8b5cf6",
  "flow-agent": "#f59e0b",
  "agent-agent": "#a78bfa",
};

/* ─────────────────── custom node renderers ─────────────────── */

function WorkspaceNode({ data }: NodeProps) {
  const d = data as { label: string; meta?: { teamCount?: number; agentCount?: number; flowCount?: number } };
  return (
    <div className="relative flex min-w-[260px] items-center gap-3 rounded-2xl border border-violet-400/40 bg-gradient-to-br from-violet-500/15 via-zinc-900 to-zinc-900 px-4 py-3 shadow-[0_0_60px_-15px_rgba(139,92,246,0.5)]">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 text-violet-200">
        <Building2 className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-300/80">Workspace</div>
        <div className="truncate text-base font-semibold text-zinc-50">{d.label}</div>
        <div className="mt-0.5 text-[10px] text-zinc-500">
          {d.meta?.teamCount ?? 0} equipos · {d.meta?.agentCount ?? 0} agentes · {d.meta?.flowCount ?? 0} flujos
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: COLORS.workspace }} />
    </div>
  );
}

function TeamNode({ data }: NodeProps) {
  const d = data as {
    label: string;
    meta?: { color?: string; agentCount?: number; activeCount?: number; description?: string; orphan?: boolean };
  };
  const color = d.meta?.color ?? COLORS.team;
  return (
    <div
      className="relative flex min-w-[200px] items-center gap-2.5 rounded-xl border border-white/[0.1] bg-zinc-900/95 px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
      style={{ borderTopWidth: 3, borderTopColor: color }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: color + "22", color }}>
        <Layers className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-100">{d.label}</div>
        <div className="text-[10px] text-zinc-500">
          {d.meta?.agentCount ?? 0} agentes
          {(d.meta?.activeCount ?? 0) > 0 && (
            <span className="ml-1 text-emerald-400">· {d.meta?.activeCount} activos</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
}

function AgentNode({ data }: NodeProps) {
  const d = data as {
    label: string;
    meta?: {
      role?: string;
      model?: string;
      status?: string;
      kind?: string;
      color?: string;
      toolCount?: number;
      channels?: Array<{ id: string; type: string; name: string }>;
    };
  };
  const color = d.meta?.color ?? COLORS.agent;
  const status = d.meta?.status ?? "draft";
  const isFlow = d.meta?.kind === "flow";
  const channelCount = d.meta?.channels?.length ?? 0;
  return (
    <div
      className="relative min-w-[220px] rounded-xl border border-white/[0.1] bg-zinc-900/95 px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <Handle type="source" position={Position.Right} id="out-right" style={{ background: color }} />
      <Handle type="target" position={Position.Left} id="in-left" style={{ background: color }} />
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: color }}>
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-zinc-100">{d.label}</span>
            <span
              className={
                status === "active"
                  ? "h-1.5 w-1.5 rounded-full bg-emerald-400"
                  : status === "draft"
                  ? "h-1.5 w-1.5 rounded-full bg-amber-400"
                  : "h-1.5 w-1.5 rounded-full bg-zinc-600"
              }
              title={status}
            />
          </div>
          <div className="truncate text-[10px] text-zinc-500">{d.meta?.role}</div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
        <span className="font-mono">{d.meta?.model}</span>
        {isFlow && (
          <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
            Flow
          </span>
        )}
        {(d.meta?.toolCount ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 text-zinc-400">
            <Wrench className="h-2.5 w-2.5" /> {d.meta?.toolCount}
          </span>
        )}
        {channelCount > 0 && (
          <span className="flex items-center gap-0.5 text-blue-400">
            <Radio className="h-2.5 w-2.5" /> {channelCount}
          </span>
        )}
      </div>
    </div>
  );
}

function FlowNode({ data }: NodeProps) {
  const d = data as { label: string; meta?: { live?: boolean; agentCount?: number; status?: string } };
  return (
    <div className="relative flex min-w-[180px] items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 shadow-[0_8px_24px_rgba(245,158,11,0.15)]">
      <Handle type="source" position={Position.Bottom} style={{ background: COLORS.flow }} />
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/25 text-amber-300">
        <Workflow className="h-3 w-3" />
      </div>
      <span className="truncate text-xs font-medium text-amber-100">{d.label}</span>
      {d.meta?.live && (
        <span className="ml-auto flex items-center gap-0.5 text-[9px] uppercase tracking-wider text-emerald-300">
          <Zap className="h-2.5 w-2.5" /> live
        </span>
      )}
    </div>
  );
}

const nodeTypes = {
  workspace: WorkspaceNode,
  team: TeamNode,
  agent: AgentNode,
  flow: FlowNode,
};

/* ─────────────────── hierarchical layout ─────────────────── */

const COL_WIDTH_AGENT = 240;
const COL_GAP_TEAM = 36;
const ROW_WORKSPACE_Y = 0;
const ROW_TEAM_Y = 150;
const ROW_AGENT_Y = 300;
const ROW_FLOW_Y = 480;

function layoutNodes(rawNodes: OrgNode[], rawEdges: OrgEdge[]): Node[] {
  const ws = rawNodes.find((n) => n.type === "workspace");
  const allTeams = rawNodes.filter((n) => n.type === "team");
  const agents = rawNodes.filter((n) => n.type === "agent");
  const flows = rawNodes.filter((n) => n.type === "flow");

  const agentsByTeam = new Map<string, string[]>();
  for (const e of rawEdges) {
    if (e.kind === "team-agent") {
      if (!agentsByTeam.has(e.source)) agentsByTeam.set(e.source, []);
      agentsByTeam.get(e.source)!.push(e.target);
    }
  }

  // Drop empty teams from the layout — they only add visual noise.
  // (They still exist in the DB; user just won't see empty squads in the org chart.)
  const teams = allTeams.filter((t) => (agentsByTeam.get(t.id)?.length ?? 0) > 0);

  const teamAgentCounts = teams.map((t) => agentsByTeam.get(t.id)!.length);
  const totalAgentCols = teamAgentCounts.reduce((a, b) => a + b, 0);
  const totalWidth =
    totalAgentCols * COL_WIDTH_AGENT + Math.max(0, teams.length - 1) * COL_GAP_TEAM;
  const startX = -totalWidth / 2;

  const out: Node[] = [];
  const agentX = new Map<string, number>();

  if (ws) {
    out.push({
      id: ws.id,
      type: "workspace",
      data: { label: ws.label, meta: ws.meta },
      position: { x: -130, y: ROW_WORKSPACE_Y },
      // user-draggable now (was false → broke "drag node" UX)
    });
  }

  let cursor = startX;
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i]!;
    const cnt = teamAgentCounts[i]!;
    const teamWidth = cnt * COL_WIDTH_AGENT;
    const teamCenterX = cursor + teamWidth / 2;
    out.push({
      id: team.id,
      type: "team",
      data: { label: team.label, meta: team.meta },
      position: { x: teamCenterX - 100, y: ROW_TEAM_Y },
    });

    const agentsForTeam = agentsByTeam.get(team.id) ?? [];
    for (let j = 0; j < agentsForTeam.length; j++) {
      const aId = agentsForTeam[j]!;
      const x = cursor + j * COL_WIDTH_AGENT + (COL_WIDTH_AGENT - 220) / 2;
      agentX.set(aId, x);
      const a = agents.find((n) => n.id === aId);
      if (a) {
        out.push({
          id: a.id,
          type: "agent",
          data: { label: a.label, meta: a.meta },
          position: { x, y: ROW_AGENT_Y },
        });
      }
    }
    cursor += teamWidth + COL_GAP_TEAM;
  }

  // Orphan agents (no team) get their own column at the end
  for (const a of agents) {
    if (!agentX.has(a.id)) {
      const x = cursor + (COL_WIDTH_AGENT - 220) / 2;
      agentX.set(a.id, x);
      out.push({
        id: a.id,
        type: "agent",
        data: { label: a.label, meta: a.meta },
        position: { x, y: ROW_AGENT_Y },
      });
      cursor += COL_WIDTH_AGENT;
    }
  }

  for (const f of flows) {
    const linked = rawEdges
      .filter((e) => e.kind === "flow-agent" && e.source === f.id)
      .map((e) => agentX.get(e.target))
      .filter((v): v is number => v != null);
    const cx = linked.length > 0 ? linked.reduce((a, b) => a + b, 0) / linked.length : 0;
    out.push({
      id: f.id,
      type: "flow",
      data: { label: f.label, meta: f.meta },
      position: { x: cx, y: ROW_FLOW_Y },
    });
  }

  return out;
}

/* ─────────────────── canvas component ─────────────────── */


export function OrgCanvas() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";
  const [data, setData] = useState<{ nodes: OrgNode[]; edges: OrgEdge[]; summary?: Summary }>({
    nodes: [],
    edges: [],
  });
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const load = () =>
      fetch("/api/org-graph")
        .then((r) => r.json())
        .then((d) => setData(d.nodes ? d : { nodes: [], edges: [] }))
        .catch(() => {});
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Single coherent view: workspace + teams + agents only. Flow nodes are
   * dropped from the visible set — flows are rendered as agent↔agent edges
   * labeled with the flow name (so the user sees "Lead Qualifier → Closer Bot
   * via Pipeline de leads" naturally, instead of a disconnected flow pill).
   *
   * Search filters individual cards but always keeps ancestors (workspace +
   * parent team) visible so the tree stays connected.
   */
  const visibleNodes = useMemo(() => {
    const baseNodes = data.nodes.filter((n) => n.type !== "flow");
    const norm = filter.trim().toLowerCase();
    if (!norm) return baseNodes;

    const matches = (n: OrgNode) =>
      n.type === "workspace" ||
      n.label.toLowerCase().includes(norm) ||
      String((n.meta?.role as string) ?? "").toLowerCase().includes(norm);

    // Build child→parent map from team-agent edges, then ensure ancestors are kept.
    const parentOf = new Map<string, string>();
    for (const e of data.edges) {
      if (e.kind === "team-agent" || e.kind === "ws-team") {
        parentOf.set(e.target, e.source);
      }
    }
    const keep = new Set<string>();
    for (const n of baseNodes) {
      if (matches(n)) {
        keep.add(n.id);
        let p: string | undefined = parentOf.get(n.id);
        while (p) {
          keep.add(p);
          p = parentOf.get(p);
        }
      }
    }
    return baseNodes.filter((n) => keep.has(n.id));
  }, [data.nodes, data.edges, filter]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  /**
   * Hold mutable node state so the user can drag nodes manually. Las posiciones
   * se preservan a través de refreshes de datos (`userMovedRef`) Y a través de
   * full reloads (localStorage), de modo que cuando un usuario acomoda su
   * organigrama, lo encuentra igual la próxima vez.
   *
   * Key de localStorage scoped por workspace id (extraído del primer nodo
   * "workspace") — si el usuario cambia de workspace, no contaminamos.
   */
  const wsNode = data.nodes.find((n) => n.type === "workspace");
  const storageKey = wsNode ? `orchester:org:positions:${wsNode.id}` : null;
  const userMovedRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Hydrate userMovedRef desde localStorage la primera vez que conocemos el ws.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !storageKey || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, { x: number; y: number }>;
        for (const [id, pos] of Object.entries(parsed)) {
          if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
            userMovedRef.current.set(id, pos);
          }
        }
      }
    } catch {
      // localStorage corrupto → ignorar y empezar limpio
    }
    hydratedRef.current = true;
  }, [storageKey]);

  // Persistir posiciones movidas al localStorage (debounced).
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(() => {
    if (!storageKey || typeof window === "undefined") return;
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = setTimeout(() => {
      const obj: Record<string, { x: number; y: number }> = {};
      userMovedRef.current.forEach((v, k) => {
        obj[k] = v;
      });
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(obj));
      } catch {
        // quota exceeded o privacy mode → ignorar
      }
    }, 250);
  }, [storageKey]);

  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const layoutKey = useMemo(
    () => visibleNodes.map((n) => n.id).sort().join(","),
    [visibleNodes]
  );

  useEffect(() => {
    const computed = layoutNodes(visibleNodes, data.edges);
    // Restore user-moved positions
    const merged = computed.map((n) => {
      const moved = userMovedRef.current.get(n.id);
      return moved ? { ...n, position: moved } : n;
    });
    setFlowNodes(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // Update node *data* in place (status, channel count, etc.) without losing
  // positions when the org-graph re-fetches.
  useEffect(() => {
    setFlowNodes((curr) => {
      if (curr.length === 0) return curr;
      const map = new Map(visibleNodes.map((n) => [n.id, n]));
      return curr.map((cn) => {
        const fresh = map.get(cn.id);
        if (!fresh) return cn;
        return { ...cn, data: { label: fresh.label, meta: fresh.meta } };
      });
    });
  }, [visibleNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setFlowNodes((nds) => {
        const next = applyNodeChanges(changes, nds);
        // Track positions so refreshes don't snap them back.
        let touched = false;
        for (const c of changes) {
          if (c.type === "position" && c.position && !c.dragging) {
            userMovedRef.current.set(c.id, c.position);
            touched = true;
          }
        }
        if (touched) persist();
        return next;
      });
    },
    [persist]
  );

  function resetLayout() {
    userMovedRef.current.clear();
    if (storageKey && typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
    setFlowNodes(layoutNodes(visibleNodes, data.edges));
  }

  const flowEdges: Edge[] = useMemo(
    () =>
      data.edges
        .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
        .map((e) => {
          const edge: Edge = {
            id: e.id,
            source: e.source,
            target: e.target,
            // smoothstep gives orthogonal lines — much cleaner than the default bezier
            type: e.kind === "agent-agent" ? "default" : "smoothstep",
            animated: e.animated ?? false,
            style: {
              stroke: EDGE_COLORS[e.kind] ?? "#52525b",
              strokeWidth: e.kind === "agent-agent" ? 2 : 1.6,
              ...(e.kind === "flow-agent" ? { strokeDasharray: "4 4" } : {}),
            },
          };
          if (e.kind === "agent-agent") {
            edge.sourceHandle = "out-right";
            edge.targetHandle = "in-left";
          }
          if (e.label) {
            edge.label = e.label;
            edge.labelStyle = { fill: "#a1a1aa", fontSize: 10 };
            edge.labelBgStyle = { fill: "#0a0a0a" };
          }
          return edge;
        }),
    [data.edges, visibleIds]
  );

  function onNodeClick(_: React.MouseEvent, node: Node) {
    const id = node.id;
    if (id.startsWith("agent:")) router.push(`/${locale}/agents/${id.slice(6)}`);
    else if (id.startsWith("flow:")) router.push(`/${locale}/flows/${id.slice(5)}`);
    else if (id.startsWith("team:") && !id.endsWith("__orphan__")) router.push(`/${locale}/teams/${id.slice(5)}`);
  }

  return (
    <div className="flex h-[calc(100vh-160px)] flex-col">
      <div className="flex flex-wrap items-center gap-3 px-1 py-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-900/40 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar agente, equipo, flujo…"
            className="w-48 bg-transparent text-xs text-zinc-100 placeholder-zinc-600 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={resetLayout}
          className="rounded-md border border-white/[0.08] px-2.5 py-1 text-xs text-zinc-400 hover:bg-white/5"
          title="Volver al layout original"
        >
          Reset layout
        </button>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500">
          {data.summary && (
            <>
              <span>
                <strong className="text-zinc-300">{data.summary.teams}</strong> equipos
              </span>
              <span>
                <strong className="text-zinc-300">{data.summary.agents}</strong> agentes ({data.summary.activeAgents} activos)
              </span>
              <span>
                <strong className="text-zinc-300">{data.summary.flows}</strong> flujos
                {data.summary.liveFlows > 0 && (
                  <span className="text-emerald-400"> · {data.summary.liveFlows} live</span>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-950/40">
        {data.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-zinc-500">
            <Bot className="mb-3 h-10 w-10 text-zinc-700" />
            <p className="text-sm">Aún no hay agentes ni equipos.</p>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/agents`)}
              className="mt-3 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
            >
              Crear el primer agente
            </button>
          </div>
        ) : (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.15}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            // Pan only on drag in EMPTY space; drag on a node moves the node.
            // Default already does this, but be explicit so shift-drag also pans.
            panOnDrag
            selectionOnDrag={false}
            zoomOnScroll
            panOnScroll={false}
          >
            <Background color="#27272a" gap={20} />
            <Controls className="!border-white/10 !bg-zinc-900" />
            <MiniMap
              pannable
              zoomable
              className="!border-white/10 !bg-zinc-900"
              nodeColor={(n) => {
                if (n.type === "workspace") return COLORS.workspace;
                if (n.type === "team") return COLORS.team;
                if (n.type === "agent") return COLORS.agent;
                if (n.type === "flow") return COLORS.flow;
                return "#52525b";
              }}
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
