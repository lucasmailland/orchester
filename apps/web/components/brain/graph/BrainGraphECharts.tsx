"use client";
// components/brain/graph/BrainGraphECharts.tsx
//
// Alternative Memory Graph renderer built on Apache ECharts' `graph`
// series (force layout). Consumes the SAME filtered graphData + derived
// maps as the react-force-graph canvas renderer in BrainGraph, so the two
// are interchangeable behind a toggle.
//
// Why ECharts here: its built-in `emphasis.focus: 'adjacency'` gives the
// Obsidian hover-isolate effect (light the 1-hop neighbourhood, ghost the
// rest) for free, plus roam/drag/zoom and per-node glow — all of which the
// canvas renderer hand-rolls. echarts is ~1MB so it is dynamically
// imported, client-only, exactly like react-force-graph.

import { useEffect, useRef, useState } from "react";
import { ENTITY_KIND_COLOR } from "@/lib/memory/graph-canvas";
import type { GraphNode } from "@/lib/memory/graph-canvas";
import { communityColor } from "@/lib/memory/graph-analytics";
import type { GraphAnalytics } from "@/lib/memory/graph-analytics";

// Edge styling by relation kind. `related` (the common case) is intentionally
// absent so those edges inherit the source node's colour from the series —
// the Obsidian "energy flows out of the hub" look. Structural (part_of /
// member_of) and conflict edges get a distinct treatment so the graph's
// semantics read at a glance.
const RELATION_LINE: Record<string, { color?: string; type?: "solid" | "dashed"; width?: number }> =
  {
    conflicts_with: { color: "#e24b4a", type: "dashed", width: 1.6 },
    part_of: { color: "#5dcaa5", width: 1.1 },
    member_of: { color: "#5dcaa5", width: 1.1 },
  };

// Above this many visible nodes, render only the top-N most central (PageRank)
// so the force layout stays readable and responsive. Selection + search hits
// are always kept on top of the cap.
const NODE_CAP = 350;

// ECharts graph series has no zoom() method; programmatic zoom is done by
// multiplying series[0].zoom and re-applying it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zoomEChartsBy(chart: any, factor: number) {
  const opt = chart.getOption?.();
  const cur = opt?.series?.[0]?.zoom ?? 1;
  chart.setOption({ series: [{ zoom: Math.max(0.2, Math.min(5, cur * factor)) }] });
}

export interface BrainGraphEChartsProps {
  nodes: GraphNode[];
  links: { id: string; source: string; target: string; relation?: string; confidence?: number }[];
  degreeById: Map<string, number>;
  maxSizeVal: number;
  selectedId: string | null;
  searchMatchIds: Set<string>;
  searchActive: boolean;
  // Optional structural analytics (communities + centrality). When present,
  // node size tracks PageRank and `colorMode: "community"` becomes meaningful.
  analytics?: GraphAnalytics;
  colorMode?: "kind" | "community";
  width: number;
  height: number;
  onNodeClick: (node: GraphNode) => void;
  onNodeHover: (node: GraphNode | null, clientX?: number, clientY?: number) => void;
  // Toolbar zoom/fit dispatch — BrainGraph fills this with the live instance's
  // imperative controls so the shared +/−/fit buttons drive whichever renderer
  // is active (each library has its own zoom API).
  controlsRef?: {
    current: { zoomIn: () => void; zoomOut: () => void; fit: () => void } | null;
  };
}

export function BrainGraphECharts({
  nodes,
  links,
  degreeById,
  maxSizeVal,
  selectedId,
  searchMatchIds,
  searchActive,
  analytics,
  colorMode = "kind",
  width,
  height,
  onNodeClick,
  onNodeHover,
  controlsRef,
}: BrainGraphEChartsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // Top-N cap notice (null = showing everything). capKeyRef dedupes the
  // setState so re-layouts at the same ratio don't churn React.
  const [capInfo, setCapInfo] = useState<{ shown: number; total: number } | null>(null);
  const capKeyRef = useRef<string>("");

  // Latest-value refs so the (once-bound) ECharts event handlers never read a
  // stale closure of the data/callbacks.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;
  const onHoverRef = useRef(onNodeHover);
  onHoverRef.current = onNodeHover;

  // One-time init: import echarts, create the instance, bind events. Disposed
  // on unmount (e.g. when the renderer toggles back to canvas).
  useEffect(() => {
    let disposed = false;
    void import("echarts").then((echarts) => {
      if (disposed || !containerRef.current || chartRef.current) return;
      const chart = echarts.init(containerRef.current, null, { renderer: "canvas" });
      chartRef.current = chart;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart.on("click", (p: any) => {
        if (p?.dataType !== "node") return;
        const n = nodesRef.current.find((x) => x.id === p.data?.id);
        if (n) onClickRef.current(n);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart.on("mouseover", (p: any) => {
        if (p?.dataType !== "node") return;
        const n = nodesRef.current.find((x) => x.id === p.data?.id);
        onHoverRef.current(n ?? null, p?.event?.event?.clientX, p?.event?.event?.clientY);
      });
      chart.on("mouseout", () => onHoverRef.current(null));
      if (controlsRef) {
        controlsRef.current = {
          zoomIn: () => zoomEChartsBy(chart, 1.3),
          zoomOut: () => zoomEChartsBy(chart, 1 / 1.3),
          fit: () => chart.setOption({ series: [{ zoom: 1 }] }),
        };
      }
      // Trigger the first paint now that the instance exists.
      setData();
    });
    return () => {
      disposed = true;
      if (controlsRef) controlsRef.current = null;
      chartRef.current?.dispose?.();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the series whenever the visible data / selection / search changes.
  // setData reads the current props directly (not via deps) and is invoked
  // from the effect below + the init effect above.
  const setData = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const max = Math.max(1, maxSizeVal);

    // Scalability cap: past NODE_CAP visible nodes, render only the most
    // central (PageRank) so the force layout stays legible and fast. The
    // selected node and any search hits are always kept, regardless of rank.
    let visibleNodes = nodes;
    if (analytics && nodes.length > NODE_CAP) {
      const keep = new Set(analytics.ranked.slice(0, NODE_CAP));
      if (selectedId) keep.add(selectedId);
      if (searchActive) searchMatchIds.forEach((id) => keep.add(id));
      visibleNodes = nodes.filter((n) => keep.has(n.id));
    }
    const visibleIds = new Set(visibleNodes.map((n) => n.id));

    // Surface the cap to the user (overlay badge). Mirror to state only when the
    // ratio changes so relayouts at the same ratio don't churn React.
    const capKey =
      visibleNodes.length < nodes.length ? `${visibleNodes.length}/${nodes.length}` : "";
    if (capKey !== capKeyRef.current) {
      capKeyRef.current = capKey;
      setCapInfo(capKey ? { shown: visibleNodes.length, total: nodes.length } : null);
    }

    const data = visibleNodes.map((n) => {
      const a = analytics?.byId.get(n.id);
      const val = n.mentionCount + (degreeById.get(n.id) ?? 0) * 2;
      // Colour by entity type (default) or by Louvain community.
      const color =
        colorMode === "community" && a
          ? communityColor(a.community)
          : (ENTITY_KIND_COLOR[n.entityKind ?? n.kind] ?? "#52525b");
      // Size by PageRank centrality when available (sqrt spreads the long tail
      // so mid-tier nodes stay visible); else fall back to mentions+degree.
      const symbolSize = a ? 9 + Math.sqrt(a.centrality) * 38 : 12 + (val / max) * 34;
      // Hubs keep their label at rest; leaves reveal on hover via emphasis.
      const labelShow = a ? a.centrality >= 0.28 : val >= max * 0.22;
      const isMatch = searchActive && searchMatchIds.has(n.id);
      const isSel = selectedId === n.id;
      return {
        id: n.id,
        name: n.label,
        value: val,
        symbolSize,
        itemStyle: {
          color,
          shadowBlur: isSel ? 26 : 14,
          shadowColor: color,
          borderColor: isSel ? "#a78bfa" : isMatch ? "#fbbf24" : "rgba(255,255,255,0.20)",
          borderWidth: isSel ? 2.5 : isMatch ? 2 : 0.6,
          opacity: searchActive && !isMatch ? 0.28 : 1,
        },
        label: { show: labelShow },
      };
    });
    const linkData = links
      .filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target))
      .map((l) => {
        const style = RELATION_LINE[l.relation ?? "related"];
        return {
          source: l.source,
          target: l.target,
          lineStyle: { width: 0.6 + (l.confidence ?? 0.7), ...(style ?? {}) },
        };
      });
    chart.setOption({
      backgroundColor: "transparent",
      tooltip: { show: false },
      animationDuration: 600,
      animationEasingUpdate: "quinticInOut",
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          // Repulsion scales with node count so the layout stays airy as the
          // memory grows instead of collapsing into a ball.
          force: {
            repulsion: Math.max(220, 130 + visibleNodes.length * 11),
            edgeLength: [70, 200],
            gravity: 0.04,
            friction: 0.5,
            // Settle once, then stop — continuous animation made nodes drift
            // forever, so they were hard to click. Drag still re-positions.
            layoutAnimation: false,
          },
          label: { show: true, color: "#cbd2e0", fontSize: 10, position: "right" },
          // Edges inherit the source node's colour — reads as energy flowing
          // out of each hub, the Obsidian look.
          lineStyle: { color: "source", opacity: 0.26, width: 1, curveness: 0.06 },
          emphasis: {
            focus: "adjacency",
            scale: 1.06,
            label: { show: true, fontSize: 12, color: "#ffffff", fontWeight: 500 },
            lineStyle: { opacity: 0.95, width: 2 },
            itemStyle: { shadowBlur: 24 },
          },
          blur: {
            itemStyle: { opacity: 0.14 },
            lineStyle: { opacity: 0.04 },
            label: { opacity: 0.1 },
          },
          data,
          links: linkData,
        },
      ],
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(setData, [
    nodes,
    links,
    selectedId,
    searchActive,
    searchMatchIds,
    maxSizeVal,
    degreeById,
    analytics,
    colorMode,
  ]);

  // Keep the canvas sized to the container.
  useEffect(() => {
    chartRef.current?.resize?.({ width, height });
  }, [width, height]);

  return (
    <div ref={containerRef} style={{ width, height }} className="relative bg-[#050507]">
      {capInfo && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-[#0c0c10]/90 px-2.5 py-1 text-[11px] text-zinc-400 backdrop-blur-xl tabular-nums">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          {capInfo.shown} / {capInfo.total}
        </div>
      )}
    </div>
  );
}
