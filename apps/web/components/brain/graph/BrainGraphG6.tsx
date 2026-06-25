"use client";
// components/brain/graph/BrainGraphG6.tsx
//
// Memory Graph renderer #5 — AntV G6 (v5) with a d3-force layout. G6 ships a
// rich behaviour set; we use its built-in `hover-activate` for the
// focus-adjacency highlight (light the 1-hop neighbourhood) plus
// zoom/drag/drag-element. Consumes the same filtered graphData as the other
// renderers. @antv/g6 is dynamically imported, client-only.

import { useEffect, useRef } from "react";
import { ENTITY_KIND_COLOR } from "@/lib/memory/graph-canvas";
import type { GraphNode } from "@/lib/memory/graph-canvas";

export interface BrainGraphG6Props {
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
  controlsRef?: {
    current: { zoomIn: () => void; zoomOut: () => void; fit: () => void } | null;
  };
}

const RELATION_EDGE_COLOR: Record<string, string> = {
  conflicts_with: "#e24b4a",
  part_of: "#5dcaa5",
  member_of: "#5dcaa5",
};

export function BrainGraphG6(props: BrainGraphG6Props) {
  const { width, height } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const buildData = () => {
    const p = propsRef.current;
    const max = Math.max(1, p.maxSizeVal);
    return {
      nodes: p.nodes.map((n) => {
        const val = n.mentionCount + (p.degreeById.get(n.id) ?? 0) * 2;
        const color = ENTITY_KIND_COLOR[n.entityKind ?? n.kind] ?? "#52525b";
        const isSel = p.selectedId === n.id;
        const isMatch = p.searchActive && p.searchMatchIds.has(n.id);
        return {
          id: n.id,
          style: {
            size: 14 + (val / max) * 38,
            fill: color,
            stroke: isSel ? "#a78bfa" : isMatch ? "#fbbf24" : "rgba(255,255,255,0.2)",
            lineWidth: isSel ? 2.5 : isMatch ? 2 : 0.6,
            shadowColor: color,
            shadowBlur: 10,
            labelText: val >= max * 0.22 ? n.label : "",
            labelFill: "#cbd2e0",
            labelFontSize: 10,
            labelPlacement: "right",
            opacity: p.searchActive && !isMatch ? 0.3 : 1,
          },
        };
      }),
      edges: p.links.map((l) => ({
        id: l.id,
        source: l.source,
        target: l.target,
        style: {
          stroke: RELATION_EDGE_COLOR[l.relation ?? "related"] ?? "#3a3f4d",
          lineWidth: 0.5 + (l.confidence ?? 0.7),
          strokeOpacity: 0.3,
        },
      })),
    };
  };

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void import("@antv/g6").then((G6: any) => {
      if (disposed || !containerRef.current) return;
      const graph = new G6.Graph({
        container: containerRef.current,
        width: propsRef.current.width,
        height: propsRef.current.height,
        background: "#050507",
        data: buildData(),
        node: { style: { labelBackground: false } },
        layout: {
          type: "d3-force",
          link: { distance: 100, strength: 0.3 },
          manyBody: { strength: -200 },
          collide: { radius: 28 },
        },
        behaviors: [
          "zoom-canvas",
          "drag-canvas",
          "drag-element",
          { type: "hover-activate", degree: 1 },
        ],
        animation: false,
      });
      graphRef.current = graph;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.on("node:click", (e: any) => {
        const id = e.target?.id ?? e.itemId;
        const n = propsRef.current.nodes.find((x) => x.id === id);
        if (n) propsRef.current.onNodeClick(n);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.on("node:pointerenter", (e: any) => {
        const id = e.target?.id ?? e.itemId;
        const n = propsRef.current.nodes.find((x) => x.id === id);
        propsRef.current.onNodeHover(n ?? null, e?.client?.x, e?.client?.y);
      });
      graph.on("node:pointerleave", () => propsRef.current.onNodeHover(null));
      void graph.render();
      if (propsRef.current.controlsRef) {
        propsRef.current.controlsRef.current = {
          zoomIn: () => graph.zoomBy(1.3),
          zoomOut: () => graph.zoomBy(1 / 1.3),
          fit: () => graph.fitView(),
        };
      }
      cleanup = () => {
        if (propsRef.current.controlsRef) propsRef.current.controlsRef.current = null;
        graph.destroy();
      };
    });
    return () => {
      disposed = true;
      cleanup();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.setData(buildData());
    void graph.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.nodes, props.links, props.selectedId, props.searchActive, props.searchMatchIds]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed) return;
    graph.setSize(width, height);
  }, [width, height]);

  return <div ref={containerRef} style={{ width, height }} className="bg-[#050507]" />;
}
