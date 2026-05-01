"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, Users, Workflow, User, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
  kind: string;
}

const TYPE_STYLE: Record<string, { color: string; icon: LucideIcon }> = {
  team: { color: "#3b82f6", icon: Users },
  agent: { color: "#8b5cf6", icon: Bot },
  employee: { color: "#10b981", icon: User },
  flow: { color: "#f59e0b", icon: Workflow },
};

function layoutNodes(nodes: OrgNode[]): Node[] {
  const cols: Record<string, number> = { team: 0, employee: 1, agent: 2, flow: 3 };
  const counts: Record<string, number> = { team: 0, employee: 0, agent: 0, flow: 0 };
  return nodes.map((n) => {
    const col = cols[n.type] ?? 4;
    const row = (counts[n.type] = (counts[n.type] ?? 0) + 1) - 1;
    return {
      id: n.id,
      position: { x: col * 260 + 60, y: row * 90 + 60 },
      data: { label: n.label, kind: n.type, meta: n.meta },
      type: "card",
    };
  });
}

function CardNode({
  data,
}: {
  data: { label: string; kind: string; meta?: Record<string, unknown> };
}) {
  const style = TYPE_STYLE[data.kind] ?? TYPE_STYLE.agent;
  if (!style) return null;
  const Icon = style.icon;
  const active = (data.meta?.active as boolean) ?? false;
  return (
    <div
      className="flex min-w-[200px] items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-900/95 px-3 py-2.5 shadow"
      style={{ borderLeftWidth: 3, borderLeftColor: style.color }}
    >
      <div
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{ background: style.color + "1A", color: style.color }}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-zinc-100">{data.label}</div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          {data.kind}
          {active && <span className="ml-1.5 text-emerald-400">● live</span>}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { card: CardNode };

function edgeColor(kind: string): string {
  switch (kind) {
    case "team-agent":
      return "#3b82f6";
    case "employee-agent":
      return "#10b981";
    case "flow-agent":
      return "#f59e0b";
    default:
      return "#52525b";
  }
}

export function OrgCanvas() {
  const [data, setData] = useState<{ nodes: OrgNode[]; edges: OrgEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/org-graph")
        .then((r) => r.json())
        .then((d) => setData(d.nodes ? d : { nodes: [], edges: [] }))
        .catch(() => {});
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const visibleNodes = useMemo(() => {
    return data.nodes.filter((n) => {
      if (kindFilter && n.type !== kindFilter) return false;
      if (filter && !n.label.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });
  }, [data.nodes, filter, kindFilter]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const flowNodes: Node[] = useMemo(() => layoutNodes(visibleNodes), [visibleNodes]);
  const flowEdges: Edge[] = useMemo(
    () =>
      data.edges
        .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          animated: e.kind === "flow-agent",
          style: { stroke: edgeColor(e.kind) },
        })),
    [data.edges, visibleIds]
  );

  return (
    <div className="flex h-[calc(100vh-160px)] flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar nodos…"
            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
          />
        </div>
        <div className="flex gap-1.5 text-xs">
          {["team", "agent", "employee", "flow"].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter((curr) => (curr === k ? null : k))}
              className={
                kindFilter === k
                  ? "rounded-md bg-violet-500/20 px-2 py-1 text-violet-300"
                  : "rounded-md text-zinc-500 hover:text-zinc-300"
              }
            >
              {k}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[11px] text-zinc-500">
          {visibleNodes.length} / {data.nodes.length} nodos · {flowEdges.length} conexiones
        </div>
      </div>
      <div className="flex-1 overflow-hidden rounded-xl border border-white/[0.06]">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#27272a" gap={20} />
          <Controls className="!border-white/10 !bg-zinc-900" />
          <MiniMap pannable zoomable className="!border-white/10 !bg-zinc-900" />
        </ReactFlow>
      </div>
    </div>
  );
}
