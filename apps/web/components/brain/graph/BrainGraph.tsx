"use client";
// components/brain/graph/BrainGraph.tsx
// Main Memory Graph component. Wraps react-force-graph-2d/3d with
// Orchester's canvas primitives and filter/detail UI.
//
// Interaction model (Obsidian-inspired):
//  - hover a node    → its 1-hop neighbourhood stays lit, everything else
//                      ghosts to ~10%; connected edges show relation labels
//  - search          → matches get an amber ring, the rest dims (no hiding)
//  - click           → select + smooth center
//  - double-click    → focus mode (?focus=<id>, server returns 1-hop graph)
//  - drag            → pins the node where you drop it
//  - right-click     → unpins
//  - zoom controls   → +, −, fit-to-view buttons

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { forceCollide } from "d3-force";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
// Client-safe subpath — canvas/types only, never the server DB query (which
// would drag the Postgres driver into this client bundle).
import {
  drawNode,
  drawEdge,
  nodeRadius,
  ENTITY_KIND_COLOR,
  EDGE_STYLES,
} from "@/lib/memory/graph-canvas";
import type { GraphNode, EdgeStyle } from "@/lib/memory/graph-canvas";
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

// Runtime node as the force engine sees it: layout coords + optional pin.
type SimNode = GraphNode & { x: number; y: number; fx?: number; fy?: number };

export function BrainGraph() {
  const t = useTranslations("brain.graph");
  const router = useRouter();
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";
  const searchParams = useSearchParams();
  const focusEntityId = searchParams?.get("focus") ?? undefined;

  const { data, graphData, isLoading, error, mutate } = useBrainGraph(focusEntityId);
  const filters = useGraphFilters(data?.nodes ?? [], data?.edges ?? []);
  const { filteredNodeIds, filteredEdgeIds, searchMatchIds, searchQuery } = filters;

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [is3D, setIs3D] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Hover state drives Obsidian-style neighbourhood dimming + the tooltip.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hoverNode, setHoverNode] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hoverLink, setHoverLink] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Imperative handle on the ForceGraph instance so we can call
  // `zoomToFit` after the d3-force simulation settles AND tune the
  // d3-force parameters (charge/link distance). The ref type is
  // intentionally loose — react-force-graph's strict ForceGraphMethods
  // type doesn't survive the `dynamic()` barrel used to ship the
  // canvas bundle client-only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  // Apply d3-force tuning to the given instance. Called both from the
  // callback ref (first mount of the dynamic component) and from the
  // filteredGraphData effect (new simulation on every data change).
  // Keeping the logic in one place avoids drift between the two call sites.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setupForces = useCallback((fg: any) => {
    if (!fg || typeof fg.d3Force !== "function") return;
    const charge = fg.d3Force("charge");
    if (charge && typeof charge.strength === "function") charge.strength(-1200);
    const link = fg.d3Force("link");
    if (link && typeof link.distance === "function") link.distance(220);
    if (link && typeof link.strength === "function") link.strength(0.1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collide = forceCollide((node: any) => {
      const labelHalfWidth = Math.max(28, Math.min(80, String(node?.label ?? "").length * 3.5));
      return labelHalfWidth + 18;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).strength(1.0) as any;
    fg.d3Force("collide", collide);
    if (typeof fg.d3ReheatSimulation === "function") fg.d3ReheatSimulation();
  }, []);

  // Callback ref — fires the moment the dynamic ForceGraph component
  // mounts (i.e. after the dynamic() import resolves). A plain useRef
  // stays null until after the first useEffect run, meaning the force
  // tuning effect exits early and the simulation runs all warmup +
  // cooldown ticks with d3 defaults (charge=-30, link=30) → collapsed
  // cluster. The callback ref guarantees forces are set before tick 1.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFgRef = useCallback(
    (instance: any) => {
      fgRef.current = instance;
      if (instance) setupForces(instance);
    },
    [setupForces]
  );

  // Callback ref, NOT a mount effect: the component early-returns through
  // loading/error/empty states, so the real container mounts several renders
  // after the first effect pass — a []-dep effect would observe nothing and
  // leave the canvas stuck at the 800×600 default.
  //
  // Height is measured against the VIEWPORT, not the container: the shell
  // wraps pages in a plain `p-6` div with no height chain, so the container's
  // own height is content-driven — reading clientHeight here would return 0
  // and collapse the canvas.
  const cleanupRef = useRef<(() => void) | null>(null);
  const handleContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      setDimensions({
        width: el.clientWidth,
        height: Math.max(420, window.innerHeight - top - 24),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    cleanupRef.current = () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const filteredGraphData = useMemo(
    () => ({
      nodes: graphData.nodes.filter((n) => filteredNodeIds.has(n.id)),
      links: graphData.links.filter((l) => filteredEdgeIds.has(l.id)),
    }),
    [graphData, filteredNodeIds, filteredEdgeIds]
  );

  // Re-tune whenever the graph data changes — react-force-graph creates
  // a fresh simulation on every graphData prop change, so forces must
  // be re-applied each time. The first-mount case is handled by the
  // handleFgRef callback above.
  useEffect(() => {
    setupForces(fgRef.current);
  }, [filteredGraphData, setupForces]);

  // Adjacency + degree, derived from the VISIBLE links. The force engine
  // mutates link.source/.target from id strings into node objects after the
  // first tick, so resolve both shapes.
  const { neighborsById, degreeById, maxSizeVal } = useMemo(() => {
    const neighbors = new Map<string, Set<string>>();
    const degree = new Map<string, number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idOf = (end: any): string => (typeof end === "object" && end ? end.id : end);
    for (const l of filteredGraphData.links) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = idOf((l as any).source);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tg = idOf((l as any).target);
      if (!neighbors.has(s)) neighbors.set(s, new Set());
      if (!neighbors.has(tg)) neighbors.set(tg, new Set());
      neighbors.get(s)!.add(tg);
      neighbors.get(tg)!.add(s);
      degree.set(s, (degree.get(s) ?? 0) + 1);
      degree.set(tg, (degree.get(tg) ?? 0) + 1);
    }
    // Node size encodes importance: mentions + connectivity. Connectivity is
    // weighted heavier (×2) — a hub with few mentions still matters more for
    // navigation than a much-mentioned leaf (Obsidian sizes purely by links).
    let max = 1;
    for (const n of filteredGraphData.nodes) {
      const v = n.mentionCount + (degree.get(n.id) ?? 0) * 2;
      if (v > max) max = v;
    }
    return { neighborsById: neighbors, degreeById: degree, maxSizeVal: max };
  }, [filteredGraphData]);

  const radiusFor = useCallback(
    (n: GraphNode) => nodeRadius(n.mentionCount + (degreeById.get(n.id) ?? 0) * 2, maxSizeVal),
    [degreeById, maxSizeVal]
  );

  const searchActive = searchQuery.trim().length > 0;
  const hoverNeighborhood: Set<string> | null = useMemo(() => {
    if (!hoverNode) return null;
    const set = new Set<string>(neighborsById.get(hoverNode.id) ?? []);
    set.add(hoverNode.id);
    return set;
  }, [hoverNode, neighborsById]);

  // Status bar reflects the FILTERED view, not the full server payload, so the
  // counts track the chips/slider/search the operator has applied.
  const visibleEntityCount = useMemo(
    () => filteredGraphData.nodes.filter((n) => n.kind === "entity").length,
    [filteredGraphData]
  );
  const visibleRelationCount = filteredGraphData.links.length;

  const relationLabel = useCallback(
    (relation: string) => {
      const key = `edgeLabels.${relation}`;
      return t.has(key) ? t(key) : relation.replace(/_/g, " ");
    },
    [t]
  );

  const nodeCanvasObject = useCallback(
    (node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as unknown as SimNode;
      const color = ENTITY_KIND_COLOR[n.entityKind ?? n.kind] ?? "#52525b";
      const r = radiusFor(n);
      const hovered = hoverNode?.id === n.id;
      // Hover dimming wins over search dimming: while inspecting a
      // neighbourhood, the whole neighbourhood stays lit even if some of it
      // doesn't match the query.
      const dimmed = hoverNeighborhood
        ? !hoverNeighborhood.has(n.id)
        : searchActive && !searchMatchIds.has(n.id);
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
        dimmed,
        hovered,
        searchHit: searchActive && searchMatchIds.has(n.id),
      });
    },
    [selectedNode, hoverNode, hoverNeighborhood, searchActive, searchMatchIds, radiusFor]
  );

  // Accurate hit area for hover/click — without this react-force-graph falls
  // back to a tiny default circle that makes hovering feel broken.
  const nodePointerAreaPaint = useCallback(
    (node: Record<string, unknown>, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as unknown as SimNode;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, radiusFor(n) + 6, 0, 2 * Math.PI);
      ctx.fill();
    },
    [radiusFor]
  );

  const linkCanvasObject = useCallback(
    (link: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const src = link.source as Record<string, unknown> | undefined;
      const tgt = link.target as Record<string, unknown> | undefined;
      if (!src || !tgt || typeof src.x !== "number" || typeof tgt.x !== "number") return;
      const relation = typeof link.relation === "string" ? link.relation : "related";
      const touchesHover =
        hoverNode != null && (src.id === hoverNode.id || tgt.id === hoverNode.id);
      const emphasized = touchesHover || (hoverLink != null && hoverLink.id === link.id);
      const dimmed = hoverNode != null ? !touchesHover : searchActive && !emphasized;
      drawEdge(ctx, {
        sx: src.x,
        sy: typeof src.y === "number" ? src.y : 0,
        tx: tgt.x,
        ty: typeof tgt.y === "number" ? tgt.y : 0,
        relation,
        confidence: typeof link.confidence === "number" ? link.confidence : 0.7,
        dimmed,
        emphasized,
        ...(emphasized ? { label: relationLabel(relation) } : {}),
        globalScale,
      });
    },
    [hoverNode, hoverLink, searchActive, relationLabel]
  );

  // react-force-graph exposes only `onNodeClick`, so double-click is detected
  // manually: a second click on the same node within 300ms enters local graph
  // mode (?focus=<id> → server returns the 1-hop neighbourhood). A single click
  // selects + smoothly centers the viewport on the node. Non-entity nodes
  // (episodes/decisions) are not focusable, so they only ever select.
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);
  const handleNodeClick = useCallback(
    (node: Record<string, unknown>) => {
      const n = node as unknown as SimNode;
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
      const fg = fgRef.current;
      if (fg && typeof fg.centerAt === "function" && typeof n.x === "number") {
        fg.centerAt(n.x, n.y, 500);
      }
    },
    [router, locale, ws]
  );

  const handleNodeHover = useCallback((node: Record<string, unknown> | null) => {
    setHoverNode(node ?? null);
    const el = containerRef.current;
    if (el) el.style.cursor = node ? "pointer" : "default";
    const fg = fgRef.current;
    if (node && fg && typeof fg.graph2ScreenCoords === "function") {
      const n = node as unknown as SimNode;
      const p = fg.graph2ScreenCoords(n.x, n.y);
      setTooltipPos({ x: p.x, y: p.y });
    } else {
      setTooltipPos(null);
    }
  }, []);

  // Drag pins (fx/fy survive future simulation runs); right-click releases.
  const handleNodeDragEnd = useCallback((node: Record<string, unknown>) => {
    const n = node as unknown as SimNode;
    n.fx = n.x;
    n.fy = n.y;
  }, []);

  const handleNodeRightClick = useCallback((node: Record<string, unknown>) => {
    const n = node as unknown as SimNode;
    delete n.fx;
    delete n.fy;
    fgRef.current?.d3ReheatSimulation?.();
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Subtle dot grid behind the graph — depth cue so the canvas reads as a
  // navigable space instead of a black void. Drawn in graph coords (the ctx
  // is already transformed), so it pans/zooms with the content.
  const renderBackdrop = useCallback((ctx: CanvasRenderingContext2D, globalScale: number) => {
    const trf = ctx.getTransform();
    if (!trf.a) return;
    const x0 = -trf.e / trf.a;
    const y0 = -trf.f / trf.d;
    const x1 = (ctx.canvas.width - trf.e) / trf.a;
    const y1 = (ctx.canvas.height - trf.f) / trf.d;
    const step = 56;
    if ((x1 - x0) / step > 240) return; // zoomed far out — dots would be noise
    ctx.save();
    ctx.fillStyle = "#3f3f46";
    ctx.globalAlpha = 0.18;
    const r = Math.min(1.2, 1 / globalScale);
    for (let gx = Math.floor(x0 / step) * step; gx <= x1; gx += step) {
      for (let gy = Math.floor(y0 / step) * step; gy <= y1; gy += step) {
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.restore();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const fg = fgRef.current;
    if (!fg || typeof fg.zoom !== "function") return;
    fg.zoom(fg.zoom() * factor, 250);
  }, []);

  const zoomFit = useCallback(() => {
    fgRef.current?.zoomToFit?.(400, 100);
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
  const hoverTooltipNode = !is3D && hoverNode && tooltipPos ? (hoverNode as SimNode) : null;

  return (
    <div ref={handleContainerRef} className="flex-1 relative overflow-hidden bg-[#050507]">
      <BrainGraphFilters filters={filters} />
      <BrainGraphViewToggle is3D={is3D} onChange={setIs3D} />

      <ForceGraph
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={handleFgRef as any}
        graphData={filteredGraphData}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onNodeDragEnd={handleNodeDragEnd}
        onNodeRightClick={handleNodeRightClick}
        onBackgroundClick={handleBackgroundClick}
        backgroundColor="#050507"
        nodeId="id"
        linkSource="source"
        linkTarget="target"
        // Once the d3-force simulation settles, auto-fit the viewport
        // so EVERY node is visible with a small padding. Without this
        // the first render dumps the layout wherever d3 happened to
        // place it on tick 0 — which on small graphs is a tight pile.
        onEngineStop={() => {
          fgRef.current?.zoomToFit?.(400, 100);
        }}
        cooldownTicks={120}
        warmupTicks={0}
        {...(is3D
          ? {
              nodeColor: (n: unknown) => {
                const node = n as GraphNode;
                const base = ENTITY_KIND_COLOR[node.entityKind ?? node.kind] ?? "#52525b";
                if (hoverNeighborhood && !hoverNeighborhood.has(node.id)) return `${base}20`;
                if (searchActive && !searchMatchIds.has(node.id)) return `${base}30`;
                return base;
              },
              // Sphere volume tracks the same importance metric as 2D radius.
              nodeVal: (n: unknown) => {
                const r = radiusFor(n as GraphNode);
                return (r / 4) ** 2;
              },
              nodeLabel: (n: unknown) => {
                const node = n as GraphNode;
                const kind = node.entityKind ?? node.kind;
                const color = ENTITY_KIND_COLOR[kind] ?? "#52525b";
                return `<div style="background:#111113ee;border:1px solid #27272a;border-radius:8px;padding:6px 10px;font-size:12px;color:#e4e4e7">
                  <div style="font-weight:600">${node.label}</div>
                  <div style="color:${color};font-size:10px;text-transform:uppercase;letter-spacing:0.05em">${kind}</div>
                </div>`;
              },
              nodeOpacity: 0.9,
              linkColor: (l: unknown) => {
                const relation = (l as { relation?: string }).relation ?? "related";
                const style =
                  (EDGE_STYLES as Record<string, EdgeStyle>)[relation] ?? EDGE_STYLES.related;
                return style.color;
              },
              linkOpacity: 0.4,
              linkWidth: (l: unknown) => 0.5 + ((l as { confidence?: number }).confidence ?? 0.7),
              linkDirectionalArrowLength: 3.5,
              linkDirectionalArrowRelPos: 1,
              // Slow particle drift along edges — makes the 3D graph read as a
              // living memory web rather than a static wireframe.
              linkDirectionalParticles: 2,
              linkDirectionalParticleWidth: 1.6,
              linkDirectionalParticleSpeed: (l: unknown) =>
                ((l as { confidence?: number }).confidence ?? 0.7) * 0.006,
            }
          : {
              nodeCanvasObject,
              nodeCanvasObjectMode: () => "replace" as const,
              nodePointerAreaPaint,
              linkCanvasObject,
              linkCanvasObjectMode: () => "replace" as const,
              onLinkHover: (link: Record<string, unknown> | null) => setHoverLink(link ?? null),
              linkHoverPrecision: 6,
              onRenderFramePre: renderBackdrop,
            })}
        width={dimensions.width}
        height={dimensions.height}
      />

      {/* Hover tooltip — entity card pinned next to the hovered node (2D). */}
      {hoverTooltipNode && tooltipPos && (
        <div
          className="absolute z-20 pointer-events-none max-w-60 bg-[#111113f5] border border-zinc-800 rounded-lg px-3 py-2 backdrop-blur shadow-xl"
          style={{
            left: Math.min(tooltipPos.x + 16, dimensions.width - 250),
            top: Math.max(tooltipPos.y - 12, 8),
          }}
        >
          <p className="text-sm font-semibold text-zinc-100 leading-tight">
            {hoverTooltipNode.label}
          </p>
          <p
            className="text-[10px] font-semibold uppercase tracking-wider mt-0.5"
            style={{
              color:
                ENTITY_KIND_COLOR[hoverTooltipNode.entityKind ?? hoverTooltipNode.kind] ??
                "#a1a1aa",
            }}
          >
            {t(`kinds.${hoverTooltipNode.entityKind ?? hoverTooltipNode.kind}`)}
          </p>
          {hoverTooltipNode.description && (
            <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
              {hoverTooltipNode.description}
            </p>
          )}
          <div className="flex gap-3 mt-1.5 text-[11px] text-zinc-500">
            <span>{t("tooltip.mentions", { count: hoverTooltipNode.mentionCount })}</span>
            <span>
              {t("tooltip.connections", { count: degreeById.get(hoverTooltipNode.id) ?? 0 })}
            </span>
          </div>
          <p className="text-[10px] text-zinc-600 mt-1.5 border-t border-zinc-800/60 pt-1.5">
            {hoverTooltipNode.fx != null ? t("tooltip.pinned") : t("tooltip.hint")}
          </p>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-16 right-4 z-10 flex flex-col gap-1">
        {(
          [
            { icon: ZoomIn, label: t("zoomIn"), onClick: () => zoomBy(1.5) },
            { icon: ZoomOut, label: t("zoomOut"), onClick: () => zoomBy(1 / 1.5) },
            { icon: Maximize2, label: t("zoomFit"), onClick: zoomFit },
          ] as const
        ).map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            aria-label={label}
            title={label}
            className="h-8 w-8 inline-flex items-center justify-center bg-[#111113cc] border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors backdrop-blur"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      <BrainGraphLegend />

      <BrainGraphNodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />

      <div className="absolute bottom-4 right-14 z-10 text-xs text-zinc-500 bg-[#111113cc] border border-zinc-800 rounded px-2.5 py-1 backdrop-blur">
        {t("statusBar", { entities: visibleEntityCount, relations: visibleRelationCount })}
      </div>
    </div>
  );
}
