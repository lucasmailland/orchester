"use client";
// components/brain/graph/BrainGraph.tsx
// Main Memory Graph component. Wraps react-force-graph-2d/3d with
// Orchester's canvas primitives and filter/detail UI.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
// Client-safe subpath — canvas/types only, never the server DB query (which
// would drag the Postgres driver into this client bundle).
import { drawNode, drawEdge, nodeRadius, ENTITY_KIND_COLOR } from "@/lib/brain/graph-canvas";
import type { GraphNode } from "@/lib/brain/graph-canvas";
import { useBrainGraph } from "@/lib/hooks/use-brain-graph";
import { useGraphFilters } from "@/lib/hooks/use-graph-filters";
import { BrainGraphFilters } from "./BrainGraphFilters";
import { BrainGraphNodeDetail } from "./BrainGraphNodeDetail";
import { BrainGraphLegend } from "./BrainGraphLegend";
import { BrainGraphViewToggle } from "./BrainGraphViewToggle";
import { BrainGraphEmptyState } from "./BrainGraphEmptyState";

// Dynamic imports — react-force-graph bundles WebGL; must be client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

export function BrainGraph() {
  const t = useTranslations("brain.graph");
  const router = useRouter();
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";
  const searchParams = useSearchParams();
  const focusEntityId = searchParams?.get("focus") ?? undefined;

  const { data, graphData, maxMentionCount, isLoading, error, mutate } =
    useBrainGraph(focusEntityId);
  const filters = useGraphFilters(data?.nodes ?? [], data?.edges ?? []);
  const { filteredNodeIds, filteredEdgeIds } = filters;

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [is3D, setIs3D] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDimensions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filteredGraphData = useMemo(
    () => ({
      nodes: graphData.nodes.filter((n) => filteredNodeIds.has(n.id)),
      links: graphData.links.filter((l) => filteredEdgeIds.has(l.id)),
    }),
    [graphData, filteredNodeIds, filteredEdgeIds]
  );

  // Status bar reflects the FILTERED view, not the full server payload, so the
  // counts track the chips/slider/search the operator has applied.
  const visibleEntityCount = useMemo(
    () => filteredGraphData.nodes.filter((n) => n.kind === "entity").length,
    [filteredGraphData]
  );
  const visibleRelationCount = filteredGraphData.links.length;

  const nodeCanvasObject = useCallback(
    (node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as unknown as GraphNode & { x: number; y: number };
      const color = ENTITY_KIND_COLOR[n.entityKind ?? n.kind] ?? "#52525b";
      const r = nodeRadius(n.mentionCount, maxMentionCount);
      drawNode(ctx, {
        x: n.x,
        y: n.y,
        r,
        color,
        selected: selectedNode?.id === n.id,
        memoryStrength: n.avgMemoryStrength,
        label: n.label,
        kind: n.kind,
        ...(n.entityKind !== undefined ? { entityKind: n.entityKind } : {}),
        globalScale,
      });
    },
    [selectedNode, maxMentionCount]
  );

  const linkCanvasObject = useCallback(
    (link: Record<string, unknown>, ctx: CanvasRenderingContext2D) => {
      const src = link.source as Record<string, unknown> | undefined;
      const tgt = link.target as Record<string, unknown> | undefined;
      if (!src || !tgt || typeof src.x !== "number" || typeof tgt.x !== "number") return;
      drawEdge(ctx, {
        sx: src.x,
        sy: typeof src.y === "number" ? src.y : 0,
        tx: tgt.x,
        ty: typeof tgt.y === "number" ? tgt.y : 0,
        relation: typeof link.relation === "string" ? link.relation : "related",
        confidence: typeof link.confidence === "number" ? link.confidence : 0.7,
      });
    },
    []
  );

  // react-force-graph exposes only `onNodeClick`, so double-click is detected
  // manually: a second click on the same node within 300ms enters local graph
  // mode (?focus=<id> → server returns the 1-hop neighbourhood). A single click
  // just opens the detail panel. Non-entity nodes (episodes/decisions) are not
  // focusable, so they only ever select.
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);
  const handleNodeClick = useCallback(
    (node: Record<string, unknown>) => {
      const n = node as unknown as GraphNode;
      const now = Date.now();
      const last = lastClickRef.current;
      if (last && last.id === n.id && now - last.t < 300) {
        lastClickRef.current = null;
        if (n.kind === "entity") {
          router.push(`/${locale}/${ws}/brain/graph?focus=${encodeURIComponent(n.id)}`);
          return;
        }
      }
      lastClickRef.current = { id: n.id, t: now };
      setSelectedNode(n);
    },
    [router, locale, ws]
  );

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#050507]">
        <div className="text-zinc-500 text-sm animate-pulse">{t("loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#050507]">
        <div className="text-red-400 text-sm">
          {t("errorTitle")}{" "}
          <button onClick={() => mutate()} className="underline">
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return <BrainGraphEmptyState />;
  }

  const ForceGraph = is3D ? ForceGraph3D : ForceGraph2D;

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#050507]">
      <BrainGraphFilters filters={filters} />
      <BrainGraphViewToggle is3D={is3D} onChange={setIs3D} />

      <ForceGraph
        graphData={filteredGraphData}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        backgroundColor="#050507"
        nodeId="id"
        linkSource="source"
        linkTarget="target"
        {...(is3D
          ? {
              nodeColor: (n: unknown) => {
                const node = n as GraphNode;
                return ENTITY_KIND_COLOR[node.entityKind ?? node.kind] ?? "#52525b";
              },
            }
          : {
              nodeCanvasObject,
              nodeCanvasObjectMode: () => "replace" as const,
              linkCanvasObject,
              linkCanvasObjectMode: () => "replace" as const,
            })}
        width={dimensions.width}
        height={dimensions.height}
      />

      <BrainGraphLegend />

      <BrainGraphNodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />

      <div className="absolute bottom-4 right-14 z-10 text-xs text-zinc-500 bg-[#111113cc] border border-zinc-800 rounded px-2.5 py-1 backdrop-blur">
        {t("statusBar", { entities: visibleEntityCount, relations: visibleRelationCount })}
      </div>
    </div>
  );
}
