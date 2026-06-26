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
import { Maximize2, Minimize2, RotateCcw, Scan, Target, X, ZoomIn, ZoomOut } from "lucide-react";
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
import { BrainGraphEmptyState } from "./BrainGraphEmptyState";
import { BrainGraphECharts } from "./BrainGraphECharts";
import { computeGraphAnalytics } from "@/lib/memory/graph-analytics";

// Dynamic imports — react-force-graph bundles WebGL; must be client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

// Runtime node as the force engine sees it: layout coords + optional pin.
// `z` only exists in 3D mode.
type SimNode = GraphNode & { x: number; y: number; z?: number; fx?: number; fy?: number };

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
  // Renderer backend — two kept after the audit: ECharts (2D, polished +
  // graphology analytics) and 3D (react-force-graph-3d / Three.js).
  const [renderer, setRenderer] = useState<"echarts" | "3d">("echarts");
  // is3D drives the react-force-graph instance (the 3D force graph).
  const is3D = renderer === "3d";
  // ECharts colour encoding: by entity type, or by Louvain community (from the
  // analytics layer). Only surfaced for the ECharts renderer.
  const [colorMode, setColorMode] = useState<"kind" | "community">("kind");
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // three-spritetext touches `document` at construction time, so it's loaded
  // lazily on the client — never during SSR. Until it resolves, 3D renders
  // unlabeled spheres (one frame, in practice).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [SpriteTextCls, setSpriteTextCls] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    void import("three-spritetext").then((m) => {
      if (alive) setSpriteTextCls(() => m.default);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

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
  // Imperative zoom/fit handle for the ECharts renderer; stays null in 3D
  // (which drives the react-force-graph camera via fgRef instead).
  const libControlsRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
  } | null>(null);
  // Guards the auto-fit so it runs ONCE per layout, not on every hover. Hover
  // changes the nodeColor/nodeVal accessors, which re-heats the d3 sim, which
  // re-fires onEngineStop — and in 3D that re-fit dollies the camera out.
  const didFitRef = useRef(false);

  // Apply d3-force tuning to the given instance. Called both from the
  // callback ref (first mount of the dynamic component) and from the
  // filteredGraphData effect (new simulation on every data change).
  // Keeping the logic in one place avoids drift between the two call sites.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setupForces = useCallback((fg: any) => {
    if (!fg || typeof fg.d3Force !== "function") return;
    // Repulsion scales with graph size so the layout stays airy as memory
    // grows — a fixed charge collapses into a tight ball past ~25 nodes
    // (every leaf gets pulled toward the high-degree hubs). ~-3000 at 30.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeCount = Math.max(1, (fg.graphData?.() as any)?.nodes?.length ?? 30);
    const charge = fg.d3Force("charge");
    if (charge && typeof charge.strength === "function") charge.strength(-(900 + nodeCount * 70));
    if (charge && typeof charge.distanceMax === "function") charge.distanceMax(1600);
    const link = fg.d3Force("link");
    if (link && typeof link.distance === "function") link.distance(130);
    if (link && typeof link.strength === "function") link.strength(0.07);
    // Label-aware collision: reserve the full label box (not just the node
    // dot) so text never overlaps a neighbour, even at fit-zoom. iterations(2)
    // resolves the tighter packing the bigger radius demands.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collideForce = forceCollide((node: any) => {
      const labelHalfWidth = Math.max(36, Math.min(130, String(node?.label ?? "").length * 4.4));
      return labelHalfWidth + 28;
    })
      .strength(1)
      .iterations(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fg.d3Force("collide", collideForce as any);
  }, []);

  // Callback ref — fires the moment the dynamic ForceGraph component
  // mounts (i.e. after the dynamic() import resolves). A plain useRef
  // stays null until after the first useEffect run, meaning the force
  // tuning effect exits early and the simulation runs all warmup +
  // cooldown ticks with d3 defaults (charge=-30, link=30) → collapsed
  // cluster. The callback ref guarantees forces are set before tick 1.
  const handleFgRef = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // In fullscreen the container IS the viewport — use its own height.
      if (document.fullscreenElement === el) {
        setDimensions({ width: el.clientWidth, height: el.clientHeight });
        return;
      }
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

  // react-force-graph (Canvas/3D) MUTATES link.source/.target from id strings
  // into node OBJECTS in place, on the shared links array. The library
  // renderers (ECharts/Cytoscape/Sigma/G6) read those as ids, so once the
  // canvas has run they'd receive `[object Object]` and throw ("nonexistent
  // source"). Normalise to string ids (handling both shapes) for the library
  // renderers; memoised so they don't re-layout every render. Canvas/3D keep
  // using the raw (mutable) filteredGraphData.links.
  const normalizedLinks = useMemo(
    () =>
      filteredGraphData.links.map((l) => {
        const s = l.source as unknown as string | { id: string } | null;
        const t = l.target as unknown as string | { id: string } | null;
        return {
          ...l,
          source: s && typeof s === "object" ? s.id : (s as string),
          target: t && typeof t === "object" ? t.id : (t as string),
        };
      }),
    [filteredGraphData.links]
  );

  // Structural analytics over the VISIBLE graph: Louvain communities + PageRank
  // centrality. Drives ECharts node sizing (real importance) and the "colour by
  // community" mode. Runs on the same string-normalised links the renderer
  // consumes; memoised so it only recomputes when the visible graph changes.
  const analytics = useMemo(
    () => computeGraphAnalytics(filteredGraphData.nodes, normalizedLinks),
    [filteredGraphData.nodes, normalizedLinks]
  );

  // Re-tune whenever the graph data changes — react-force-graph creates
  // a fresh simulation on every graphData prop change, so forces must
  // be re-applied each time. The first-mount case is handled by the
  // handleFgRef callback above.
  useEffect(() => {
    setupForces(fgRef.current);
  }, [filteredGraphData, setupForces]);

  // Re-arm the one-shot auto-fit whenever the graph data or the 2D/3D mode
  // changes, so a genuinely new layout still gets fitted exactly once.
  useEffect(() => {
    didFitRef.current = false;
  }, [filteredGraphData, is3D]);

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

  // 3D sphere volume (memoised so hovering — which re-renders — doesn't hand
  // react-force-graph a fresh nodeVal accessor and re-heat the simulation).
  const nodeVal3D = useCallback(
    (n: unknown) => {
      const r = radiusFor(n as GraphNode);
      return (r / 4) ** 2;
    },
    [radiusFor]
  );

  const searchActive = searchQuery.trim().length > 0;
  const hoverNeighborhood: Set<string> | null = useMemo(() => {
    if (!hoverNode) return null;
    const set = new Set<string>(neighborsById.get(hoverNode.id) ?? []);
    set.add(hoverNode.id);
    return set;
  }, [hoverNode, neighborsById]);

  // Status bar reflects the FILTERED view, not the full server payload, so the
  // counts track the chips/slider/search the operator has applied. When the
  // two diverge it switches to "X of Y" so a partial view is never mistaken
  // for the whole graph.
  const visibleEntityCount = useMemo(
    () => filteredGraphData.nodes.filter((n) => n.kind === "entity").length,
    [filteredGraphData]
  );
  const totalEntityCount = useMemo(
    () => (data?.nodes ?? []).filter((n) => n.kind === "entity").length,
    [data]
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
      // 3D variant takes (x, y, z); the extra arg is harmless in 2D.
      const p = fg.graph2ScreenCoords(n.x, n.y, n.z ?? 0);
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

  const zoomBy = useCallback(
    (factor: number) => {
      // ECharts exposes its own zoom via libControlsRef; 3D drives the
      // react-force-graph camera below.
      if (renderer !== "3d") {
        if (factor >= 1) libControlsRef.current?.zoomIn();
        else libControlsRef.current?.zoomOut();
        return;
      }
      const fg = fgRef.current;
      if (!fg) return;
      if (typeof fg.zoom === "function") {
        fg.zoom(fg.zoom() * factor, 250);
        return;
      }
      // 3D exposes no zoom() — dolly the camera toward/away from the origin
      // (the default look-at target) instead.
      if (typeof fg.cameraPosition === "function") {
        const pos = fg.cameraPosition();
        const k = 1 / factor;
        fg.cameraPosition({ x: pos.x * k, y: pos.y * k, z: pos.z * k }, undefined, 300);
      }
    },
    [renderer]
  );

  const zoomFit = useCallback(() => {
    if (renderer !== "3d") {
      libControlsRef.current?.fit();
      return;
    }
    fgRef.current?.zoomToFit?.(400, 100);
  }, [renderer]);

  // 3D node labels — a text sprite parented under each sphere
  // (nodeThreeObjectExtend keeps the stock sphere). Memoised so hover
  // re-renders don't rebuild the whole Three.js scene.
  const nodeThreeObject = useCallback(
    (n: unknown) => {
      const node = n as GraphNode;
      const sprite = new SpriteTextCls(node.label);
      sprite.color = "#d4d4d8";
      sprite.textHeight = 7;
      sprite.material.depthWrite = false; // never occlude spheres behind it
      // Stock sphere radius = nodeRelSize(6) * cbrt(nodeVal); hang the label
      // just below it.
      const r3 = 6 * Math.cbrt((radiusFor(node) / 4) ** 2);
      sprite.position.y = -(r3 + 7);
      return sprite;
    },
    [SpriteTextCls, radiusFor]
  );

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
  const hoverTooltipNode = hoverNode && tooltipPos ? (hoverNode as SimNode) : null;
  // The node-detail panel floats at right-4 with width 288px — every control
  // anchored to the right edge slides left while it's open so nothing is
  // ever buried underneath it.
  const ctrlRight = selectedNode ? 320 : 16;
  // The shell's floating help button lives at the bottom-right corner; the
  // status pill starts further left so the two never stack.
  const statusRight = selectedNode ? 320 : 64;
  // When ?focus=<id> is active the graph shows only that entity's 1-hop
  // neighbourhood; surface the focused node so the exit banner can name it.
  const focusNode = focusEntityId ? (data?.nodes ?? []).find((n) => n.id === focusEntityId) : null;

  // Props for the ECharts renderer. The 3D renderer (react-force-graph-3d)
  // takes a different shape and stays inline below.
  const libGraphProps = {
    nodes: filteredGraphData.nodes,
    links: normalizedLinks,
    degreeById,
    maxSizeVal,
    selectedId: selectedNode?.id ?? null,
    searchMatchIds,
    searchActive,
    analytics,
    colorMode,
    width: dimensions.width,
    height: dimensions.height,
    onNodeClick: (n: GraphNode) => setSelectedNode(n),
    onNodeHover: (n: GraphNode | null, cx?: number, cy?: number) => {
      setHoverNode(n);
      if (n && cx != null && cy != null && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setTooltipPos({ x: cx - rect.left, y: cy - rect.top });
      } else {
        setTooltipPos(null);
      }
    },
    controlsRef: libControlsRef,
  };

  return (
    <div ref={handleContainerRef} className="flex-1 relative overflow-hidden bg-[#050507]">
      <BrainGraphFilters filters={filters} />
      <div
        className="absolute top-4 z-10 flex items-center gap-2 transition-[right] duration-200 ease-out"
        style={{ right: ctrlRight }}
      >
        <div className="flex rounded-lg bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 p-0.5 text-xs font-semibold shadow-lg shadow-black/40">
          {(
            [
              ["echarts", "ECharts"],
              ["3d", "3D"],
            ] as const
          ).map(([r, lbl]) => (
            <button
              key={r}
              onClick={() => setRenderer(r)}
              className={
                "px-2 py-1 rounded-md transition-colors " +
                (renderer === r ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-100")
              }
            >
              {lbl}
            </button>
          ))}
        </div>
        {renderer === "echarts" && (
          <div className="flex rounded-lg bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 p-0.5 text-xs font-semibold shadow-lg shadow-black/40">
            {(
              [
                ["kind", t("colorBy.kind")],
                ["community", t("colorBy.community")],
              ] as const
            ).map(([m, lbl]) => (
              <button
                key={m}
                onClick={() => setColorMode(m)}
                title={t("colorBy.hint")}
                className={
                  "px-2 py-1 rounded-md transition-colors " +
                  (colorMode === m
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:text-zinc-100")
                }
              >
                {lbl}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Focus-mode banner — entering local-graph mode is a navigation
          (?focus=<id>), so without this the only way back is the browser
          back button. Gives a clear, discoverable exit. */}
      {focusEntityId && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-lg border border-violet-700/50 bg-[#0c0c10]/90 px-3 py-1.5 text-xs shadow-lg shadow-black/40 backdrop-blur-xl">
          <Target className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-zinc-300">
            {t("focus.title")}
            {focusNode?.label && (
              <span className="font-semibold text-zinc-100"> · {focusNode.label}</span>
            )}
          </span>
          <button
            onClick={() => router.push(`/${locale}/${ws}/brain/graph`)}
            className="ml-1 inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 font-semibold text-white transition-colors hover:bg-violet-500"
          >
            <X className="h-3 w-3" />
            {t("focus.exit")}
          </button>
        </div>
      )}

      {renderer === "echarts" ? (
        <BrainGraphECharts {...libGraphProps} />
      ) : (
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
            // Auto-fit ONCE per layout. react-force-graph re-fires this on
            // every sim re-heat (hover changes the nodeColor/nodeVal accessors
            // → re-heat), and a re-fit in 3D dollies the camera away from the
            // node you're inspecting. The manual fit button still works.
            if (didFitRef.current) return;
            didFitRef.current = true;
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
                nodeVal: nodeVal3D,
                // Our HTML tooltip (below) covers hover info — the stock
                // nodeLabel tooltip would double it up.
                nodeLabel: () => "",
                showNavInfo: false,
                ...(SpriteTextCls ? { nodeThreeObject, nodeThreeObjectExtend: true } : {}),
                // Larger spheres than the stock 4 — at zoomToFit distance the
                // default reads as scattered dust.
                nodeRelSize: 6,
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
      )}

      {/* Filters hid everything — say so instead of presenting a void. */}
      {filteredGraphData.nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto text-center bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 rounded-2xl px-8 py-6 shadow-2xl shadow-black/50 max-w-xs">
            <p className="text-sm font-semibold text-zinc-200">{t("noMatchesTitle")}</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{t("noMatchesDesc")}</p>
            <button
              onClick={filters.resetAll}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-lg px-4 py-2 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("resetFilters")}
            </button>
          </div>
        </div>
      )}

      {/* Hover tooltip — entity card pinned next to the hovered node. */}
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

      {/* View controls — zoom, fit, fullscreen. Slides clear of the detail panel. */}
      <div
        className="absolute bottom-16 z-10 flex flex-col gap-0.5 bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 rounded-xl p-1 shadow-lg shadow-black/40 transition-[right] duration-200 ease-out"
        style={{ right: ctrlRight }}
      >
        {(
          [
            { icon: ZoomIn, label: t("zoomIn"), onClick: () => zoomBy(1.5) },
            { icon: ZoomOut, label: t("zoomOut"), onClick: () => zoomBy(1 / 1.5) },
            { icon: Scan, label: t("zoomFit"), onClick: zoomFit },
            {
              icon: isFullscreen ? Minimize2 : Maximize2,
              label: isFullscreen ? t("exitFullscreen") : t("fullscreen"),
              onClick: toggleFullscreen,
            },
          ] as const
        ).map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            aria-label={label}
            title={label}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      <BrainGraphLegend is3D={is3D} />

      <BrainGraphNodeDetail
        node={selectedNode}
        degree={selectedNode ? (degreeById.get(selectedNode.id) ?? 0) : 0}
        onClose={() => setSelectedNode(null)}
      />

      <div
        className="absolute bottom-4 z-10 text-xs text-zinc-500 bg-[#0c0c10]/90 border border-zinc-800/80 rounded-lg px-2.5 py-1 backdrop-blur-xl tabular-nums transition-[right] duration-200 ease-out"
        style={{ right: statusRight }}
      >
        {visibleEntityCount < totalEntityCount
          ? t("statusBarFiltered", {
              entities: visibleEntityCount,
              total: totalEntityCount,
              relations: visibleRelationCount,
            })
          : t("statusBar", { entities: visibleEntityCount, relations: visibleRelationCount })}
      </div>
    </div>
  );
}
