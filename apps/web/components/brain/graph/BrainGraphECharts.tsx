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

import { useEffect, useRef } from "react";
import { ENTITY_KIND_COLOR } from "@/lib/memory/graph-canvas";
import type { GraphNode } from "@/lib/memory/graph-canvas";

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

export interface BrainGraphEChartsProps {
  nodes: GraphNode[];
  links: { id: string; source: string; target: string; relation?: string; confidence?: number }[];
  degreeById: Map<string, number>;
  maxSizeVal: number;
  selectedId: string | null;
  searchMatchIds: Set<string>;
  searchActive: boolean;
  width: number;
  height: number;
  onNodeClick: (node: GraphNode) => void;
  onNodeHover: (node: GraphNode | null, clientX?: number, clientY?: number) => void;
}

export function BrainGraphECharts({
  nodes,
  links,
  degreeById,
  maxSizeVal,
  selectedId,
  searchMatchIds,
  searchActive,
  width,
  height,
  onNodeClick,
  onNodeHover,
}: BrainGraphEChartsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

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
      // Trigger the first paint now that the instance exists.
      setData();
    });
    return () => {
      disposed = true;
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
    const data = nodes.map((n) => {
      const val = n.mentionCount + (degreeById.get(n.id) ?? 0) * 2;
      const color = ENTITY_KIND_COLOR[n.entityKind ?? n.kind] ?? "#52525b";
      const isMatch = searchActive && searchMatchIds.has(n.id);
      const isSel = selectedId === n.id;
      return {
        id: n.id,
        name: n.label,
        value: val,
        symbolSize: 12 + (val / max) * 34,
        itemStyle: {
          color,
          shadowBlur: isSel ? 26 : 14,
          shadowColor: color,
          borderColor: isSel ? "#a78bfa" : isMatch ? "#fbbf24" : "rgba(255,255,255,0.20)",
          borderWidth: isSel ? 2.5 : isMatch ? 2 : 0.6,
          opacity: searchActive && !isMatch ? 0.28 : 1,
        },
        // Hubs keep their label at rest; everything else reveals on hover via
        // the emphasis state. Mirrors Obsidian's declutter-by-importance.
        label: { show: val >= max * 0.22 },
      };
    });
    const linkData = links.map((l) => {
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
            repulsion: Math.max(220, 130 + nodes.length * 11),
            edgeLength: [70, 200],
            gravity: 0.04,
            friction: 0.5,
            layoutAnimation: true,
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
  ]);

  // Keep the canvas sized to the container.
  useEffect(() => {
    chartRef.current?.resize?.({ width, height });
  }, [width, height]);

  return <div ref={containerRef} style={{ width, height }} className="bg-[#050507]" />;
}
