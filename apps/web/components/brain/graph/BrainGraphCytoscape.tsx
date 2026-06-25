"use client";
// components/brain/graph/BrainGraphCytoscape.tsx
//
// Memory Graph renderer #3 — Cytoscape.js with the fcose force layout.
// fcose produces the most "organic" clustered layout of the three force
// engines (the closest to Obsidian's look). Consumes the same filtered
// graphData + derived maps as the other renderers, behind the shared toggle.
// cytoscape (+ the fcose layout extension) is dynamically imported,
// client-only, to keep it out of SSR and the initial bundle.

import { useEffect, useRef } from "react";
import { ENTITY_KIND_COLOR } from "@/lib/memory/graph-canvas";
import type { GraphNode } from "@/lib/memory/graph-canvas";

const RELATION_EDGE_COLOR: Record<string, string> = {
  conflicts_with: "#e24b4a",
  part_of: "#5dcaa5",
  member_of: "#5dcaa5",
};

export interface BrainGraphCytoscapeProps {
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

export function BrainGraphCytoscape(props: BrainGraphCytoscapeProps) {
  const { width, height } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const buildElements = () => {
    const p = propsRef.current;
    const max = Math.max(1, p.maxSizeVal);
    const nodeEls = p.nodes.map((n) => {
      const val = n.mentionCount + (p.degreeById.get(n.id) ?? 0) * 2;
      const classes: string[] = [];
      if (p.selectedId === n.id) classes.push("sel");
      if (p.searchActive && p.searchMatchIds.has(n.id)) classes.push("match");
      if (p.searchActive && !p.searchMatchIds.has(n.id)) classes.push("dim");
      return {
        data: {
          id: n.id,
          label: n.label,
          color: ENTITY_KIND_COLOR[n.entityKind ?? n.kind] ?? "#52525b",
          size: 14 + (val / max) * 38,
          showLabel: val >= max * 0.22 ? 1 : 0,
        },
        classes: classes.join(" "),
      };
    });
    const edgeEls = p.links.map((l) => ({
      data: {
        id: l.id,
        source: l.source,
        target: l.target,
        color: RELATION_EDGE_COLOR[l.relation ?? "related"] ?? "#5a6072",
        width: 0.5 + (l.confidence ?? 0.7),
      },
    }));
    return [...nodeEls, ...edgeEls];
  };

  // One-time init.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([import("cytoscape"), import("cytoscape-fcose")]).then(([cyMod, fcoseMod]) => {
      if (disposed || !containerRef.current) return;
      const cytoscape = cyMod.default;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try {
        cytoscape.use(fcoseMod.default as any);
      } catch {
        /* already registered */
      }
      const cy = cytoscape({
        container: containerRef.current,
        elements: buildElements(),
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              width: "data(size)",
              height: "data(size)",
              label: "data(label)",
              color: "#cbd2e0",
              "font-size": 10,
              "text-valign": "center",
              "text-halign": "right",
              "text-margin-x": 4,
              "min-zoomed-font-size": 8,
              "text-opacity": "data(showLabel)",
              "border-width": 0.6,
              "border-color": "rgba(255,255,255,0.20)",
            },
          },
          {
            selector: "edge",
            style: {
              width: "data(width)",
              "line-color": "data(color)",
              opacity: 0.3,
              "curve-style": "straight",
            },
          },
          { selector: ".dim", style: { opacity: 0.12, "text-opacity": 0.06 } },
          {
            selector: ".sel",
            style: { "border-width": 2.5, "border-color": "#a78bfa", "text-opacity": 1 },
          },
          {
            selector: ".match",
            style: { "border-width": 2, "border-color": "#fbbf24", "text-opacity": 1 },
          },
          { selector: "edge.hl", style: { opacity: 0.95, width: 2 } },
          { selector: "node.lit", style: { "text-opacity": 1 } },
          // cytoscape's @types reject data() string mappers on numeric props
          // (e.g. text-opacity); the runtime supports them fine.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
        layout: {
          name: "fcose",
          quality: "default",
          animate: false,
          nodeRepulsion: 9000,
          idealEdgeLength: 95,
          nodeSeparation: 95,
          gravity: 0.25,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        minZoom: 0.1,
        maxZoom: 4,
        wheelSensitivity: 0.2,
      });
      cyRef.current = cy;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cy.on("tap", "node", (e: any) => {
        const n = propsRef.current.nodes.find((x) => x.id === e.target.id());
        if (n) propsRef.current.onNodeClick(n);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cy.on("mouseover", "node", (e: any) => {
        const node = e.target;
        const hood = node.closedNeighborhood();
        cy.elements().addClass("dim");
        hood.removeClass("dim").addClass("lit");
        hood.connectedEdges().removeClass("dim").addClass("hl");
        const n = propsRef.current.nodes.find((x) => x.id === node.id());
        const rp = node.renderedPosition();
        const rect = containerRef.current?.getBoundingClientRect();
        propsRef.current.onNodeHover(
          n ?? null,
          rect ? rect.left + rp.x : undefined,
          rect ? rect.top + rp.y : undefined
        );
      });
      cy.on("mouseout", "node", () => {
        cy.elements().removeClass("dim hl lit");
        propsRef.current.onNodeHover(null);
      });
      if (propsRef.current.controlsRef) {
        const center = () => ({ x: cy.width() / 2, y: cy.height() / 2 });
        propsRef.current.controlsRef.current = {
          zoomIn: () => cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: center() }),
          zoomOut: () => cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: center() }),
          fit: () => cy.fit(undefined, 40),
        };
      }
      cleanup = () => {
        if (propsRef.current.controlsRef) propsRef.current.controlsRef.current = null;
        cy.destroy();
      };
    });
    return () => {
      disposed = true;
      cleanup();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild elements + re-layout on data change; cheaper class-only refresh on
  // selection/search change.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(buildElements());
    });
    cy.layout({
      name: "fcose",
      quality: "default",
      animate: false,
      nodeRepulsion: 9000,
      idealEdgeLength: 95,
      nodeSeparation: 95,
      gravity: 0.25,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.nodes, props.links]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy.nodes().forEach((node: any) => {
      const p = propsRef.current;
      node.removeClass("sel match dim");
      if (p.selectedId === node.id()) node.addClass("sel");
      if (p.searchActive && p.searchMatchIds.has(node.id())) node.addClass("match");
      if (p.searchActive && !p.searchMatchIds.has(node.id())) node.addClass("dim");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedId, props.searchActive, props.searchMatchIds]);

  useEffect(() => {
    cyRef.current?.resize();
  }, [width, height]);

  return <div ref={containerRef} style={{ width, height }} className="bg-[#050507]" />;
}
