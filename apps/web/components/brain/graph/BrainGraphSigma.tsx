"use client";
// components/brain/graph/BrainGraphSigma.tsx
//
// Memory Graph renderer #4 — Sigma.js (WebGL) over a graphology model, laid
// out with ForceAtlas2. WebGL keeps it smooth at thousands of nodes, so this
// is the renderer to keep if the memory graph grows large. Hover dimming is
// done with Sigma's node/edge reducers (the focus-adjacency effect). sigma +
// graphology + the layout are dynamically imported, client-only.

import { useEffect, useRef } from "react";
import { ENTITY_KIND_COLOR } from "@/lib/memory/graph-canvas";
import type { GraphNode } from "@/lib/memory/graph-canvas";

export interface BrainGraphSigmaProps {
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

export function BrainGraphSigma(props: BrainGraphSigmaProps) {
  const { width, height } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sigmaRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const hoveredRef = useRef<string | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const populate = (Graph: any, forceAtlas2: any) => {
    const p = propsRef.current;
    const max = Math.max(1, p.maxSizeVal);
    const graph = new Graph();
    p.nodes.forEach((n, i) => {
      const val = n.mentionCount + (p.degreeById.get(n.id) ?? 0) * 2;
      const angle = (2 * Math.PI * i) / Math.max(1, p.nodes.length);
      graph.addNode(n.id, {
        label: n.label,
        x: Math.cos(angle) * (1 + (i % 7) * 0.1),
        y: Math.sin(angle) * (1 + (i % 5) * 0.1),
        size: 4 + (val / max) * 16,
        color: ENTITY_KIND_COLOR[n.entityKind ?? n.kind] ?? "#52525b",
      });
    });
    p.links.forEach((l) => {
      if (!graph.hasNode(l.source) || !graph.hasNode(l.target) || l.source === l.target) return;
      try {
        graph.addEdgeWithKey(l.id, l.source, l.target, {
          size: 0.5 + (l.confidence ?? 0.7),
          color: RELATION_EDGE_COLOR[l.relation ?? "related"] ?? "#3a3f4d",
        });
      } catch {
        /* duplicate edge — skip */
      }
    });
    forceAtlas2.assign(graph, {
      iterations: 220,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        gravity: 1.2,
        scalingRatio: 14,
        slowDown: 4,
      },
    });
    return graph;
  };

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([
      import("graphology"),
      import("sigma"),
      import("graphology-layout-forceatlas2"),
    ]).then(([G, S, FA2]) => {
      if (disposed || !containerRef.current) return;
      const Graph = G.default;
      const Sigma = S.default;
      const forceAtlas2 = FA2.default;
      const graph = populate(Graph, forceAtlas2);
      graphRef.current = graph;
      const renderer = new Sigma(graph, containerRef.current, {
        renderEdgeLabels: false,
        labelColor: { color: "#cbd2e0" },
        labelFont: "Inter, system-ui, sans-serif",
        labelSize: 11,
        labelRenderedSizeThreshold: 7,
        defaultEdgeColor: "#3a3f4d",
        minCameraRatio: 0.08,
        maxCameraRatio: 8,
      });
      sigmaRef.current = renderer;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.setSetting("nodeReducer", (node: string, data: any) => {
        const h = hoveredRef.current;
        const p = propsRef.current;
        const res = { ...data };
        if (p.selectedId === node) res.highlighted = true;
        if (p.searchActive && p.searchMatchIds.has(node)) res.highlighted = true;
        if (p.searchActive && !p.searchMatchIds.has(node)) {
          res.color = "#262a33";
          res.label = "";
        }
        if (h && node !== h && !graph.areNeighbors(h, node)) {
          res.color = "#20242c";
          res.label = "";
          res.zIndex = 0;
        }
        return res;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.setSetting("edgeReducer", (edge: string, data: any) => {
        const h = hoveredRef.current;
        const res = { ...data };
        if (h && !graph.extremities(edge).includes(h)) res.hidden = true;
        return res;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.on("clickNode", ({ node }: any) => {
        const n = propsRef.current.nodes.find((x) => x.id === node);
        if (n) propsRef.current.onNodeClick(n);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.on("enterNode", ({ node }: any) => {
        hoveredRef.current = node;
        renderer.refresh();
        const n = propsRef.current.nodes.find((x) => x.id === node);
        const vp = renderer.getNodeDisplayData(node);
        const rect = containerRef.current?.getBoundingClientRect();
        propsRef.current.onNodeHover(
          n ?? null,
          rect && vp ? rect.left + vp.x : undefined,
          rect && vp ? rect.top + vp.y : undefined
        );
      });
      renderer.on("leaveNode", () => {
        hoveredRef.current = null;
        renderer.refresh();
        propsRef.current.onNodeHover(null);
      });
      const cam = renderer.getCamera();
      if (propsRef.current.controlsRef) {
        propsRef.current.controlsRef.current = {
          zoomIn: () => cam.animatedZoom({ duration: 200 }),
          zoomOut: () => cam.animatedUnzoom({ duration: 200 }),
          fit: () => cam.animatedReset({ duration: 300 }),
        };
      }
      cleanup = () => {
        if (propsRef.current.controlsRef) propsRef.current.controlsRef.current = null;
        renderer.kill();
      };
    });
    return () => {
      disposed = true;
      cleanup();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the model on data change.
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer || !graphRef.current) return;
    void Promise.all([import("graphology"), import("graphology-layout-forceatlas2")]).then(
      ([G, FA2]) => {
        const graph = populate(G.default, FA2.default);
        graphRef.current = graph;
        renderer.setGraph(graph);
        renderer.refresh();
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.nodes, props.links]);

  // Selection / search restyle without re-layout.
  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [props.selectedId, props.searchActive, props.searchMatchIds]);

  useEffect(() => {
    sigmaRef.current?.resize();
  }, [width, height]);

  return <div ref={containerRef} style={{ width, height }} className="bg-[#050507]" />;
}
