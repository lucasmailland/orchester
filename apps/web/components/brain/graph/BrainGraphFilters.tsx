"use client";
import { useState, useMemo, useEffect } from "react";
import { GitBranchPlus, RotateCcw, Route, Search, SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ENTITY_KIND_COLOR, EDGE_STYLES, debounce } from "@/lib/memory/graph-canvas";
import { ALL_NODE_KINDS, ALL_EDGE_TYPES } from "@/lib/hooks/use-graph-filters";
import type { GraphFiltersState } from "@/lib/hooks/use-graph-filters";
import type { GraphNavigationState } from "@/lib/hooks/use-graph-navigation";

// Glyph per node kind (mirrors the canvas shape vocabulary).
const KIND_ICON: Record<string, string> = {
  person: "●",
  organization: "⬡",
  project: "▣",
  concept: "◆",
  place: "⬠",
  other: "●",
  episode: "▶",
  decision: "⚖",
};

interface Props {
  filters: GraphFiltersState;
  nav: GraphNavigationState;
}

/** Section header with All / None bulk toggles on the right. */
function SectionHeader({
  label,
  onAll,
  onNone,
  allLabel,
  noneLabel,
}: {
  label: string;
  onAll: () => void;
  onNone: () => void;
  allLabel: string;
  noneLabel: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <span className="text-[10px] text-zinc-600">
        <button onClick={onAll} className="hover:text-violet-400 transition-colors">
          {allLabel}
        </button>
        <span className="mx-1 text-zinc-700">/</span>
        <button onClick={onNone} className="hover:text-violet-400 transition-colors">
          {noneLabel}
        </button>
      </span>
    </div>
  );
}

export function BrainGraphFilters({ filters, nav }: Props) {
  const t = useTranslations("brain.graph");
  const [collapsed, setCollapsed] = useState(false);

  // Local slider state for instant thumb movement; the actual filter setter
  // is debounced so the expensive analytics recompute only fires after the
  // drag settles (200ms idle).
  const [localStrength, setLocalStrength] = useState(filters.minMemoryStrength);
  const debouncedCommit = useMemo(
    () => debounce(filters.setMinMemoryStrength, 200),
    [filters.setMinMemoryStrength]
  );
  useEffect(() => () => debouncedCommit.cancel(), [debouncedCommit]);

  // Count of non-default filters so the collapsed chip can signal "filters
  // active" without expanding.
  const activeCount =
    ALL_NODE_KINDS.length -
    filters.visibleNodeKinds.size +
    (ALL_EDGE_TYPES.length - filters.visibleEdgeTypes.size) +
    (filters.minMemoryStrength > 0 ? 1 : 0) +
    (filters.searchQuery.trim() ? 1 : 0);

  const searchActive = filters.searchQuery.trim().length > 0;
  const visibleCount = filters.filteredNodes.length;
  const nothingVisible = visibleCount === 0 && filters.totalNodeCount > 0;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        aria-label={t("showFilters")}
        title={t("showFilters")}
        className="absolute top-4 left-4 z-10 flex items-center gap-1.5 bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 rounded-xl px-3 py-2 text-zinc-400 shadow-lg shadow-black/40 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
      >
        <SlidersHorizontal className="h-4 w-4" />
        {activeCount > 0 && (
          <span className="text-[10px] font-bold bg-violet-600 text-white rounded-full h-4 min-w-4 px-1 inline-flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="absolute top-4 left-4 z-10 w-60 max-h-[calc(100%-2rem)] overflow-y-auto bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 rounded-2xl p-4 shadow-2xl shadow-black/50">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-400">
          {t("filter")}
        </p>
        <div className="flex items-center gap-0.5 -mr-1.5 -mt-0.5">
          {activeCount > 0 && (
            <button
              onClick={filters.resetAll}
              aria-label={t("resetFilters")}
              title={t("resetFilters")}
              className="text-zinc-500 hover:text-violet-300 transition-colors p-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setCollapsed(true)}
            aria-label={t("hideFilters")}
            title={t("hideFilters")}
            className="text-zinc-600 hover:text-zinc-300 transition-colors p-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div
        className={`flex items-center gap-1.5 bg-zinc-900/80 border rounded-lg px-2.5 py-1.5 transition-colors ${
          searchActive ? "border-amber-500/40" : "border-zinc-800 focus-within:border-zinc-700"
        }`}
      >
        <Search
          className={`h-3 w-3 flex-shrink-0 ${searchActive ? "text-amber-400" : "text-zinc-500"}`}
        />
        <input
          aria-label={t("searchPlaceholder")}
          className="bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none w-full"
          placeholder={t("searchPlaceholder")}
          value={filters.searchQuery}
          onChange={(e) => filters.setSearchQuery(e.target.value)}
        />
        {searchActive && (
          <button
            onClick={() => filters.setSearchQuery("")}
            aria-label={t("clearSearch")}
            title={t("clearSearch")}
            className="text-zinc-500 hover:text-zinc-200 transition-colors flex-shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {searchActive && (
        <p className="text-[10px] text-amber-400/90 mt-1 mb-0.5">
          {t("matches", { count: filters.searchMatchIds.size })}
        </p>
      )}

      <div className="h-px bg-zinc-800/60 my-3" />

      {/* Node type chips — every node kind is toggleable, with live counts. */}
      <SectionHeader
        label={t("nodeTypes")}
        onAll={() => filters.setAllNodeKinds(true)}
        onNone={() => filters.setAllNodeKinds(false)}
        allLabel={t("all")}
        noneLabel={t("none")}
      />
      <div className="flex flex-wrap gap-1 mb-3">
        {ALL_NODE_KINDS.map((kind) => {
          const active = filters.visibleNodeKinds.has(kind);
          const color = ENTITY_KIND_COLOR[kind] ?? "#52525b";
          const count = filters.nodeKindCounts[kind] ?? 0;
          return (
            <button
              key={kind}
              onClick={() => filters.toggleNodeKind(kind)}
              aria-pressed={active}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium border transition-all hover:brightness-125"
              style={{
                borderColor: active ? `${color}50` : "#27272a",
                backgroundColor: active ? `${color}1a` : "transparent",
                color: active ? color : "#52525b",
                opacity: count === 0 ? 0.45 : 1,
              }}
            >
              <span className="text-[9px]">{KIND_ICON[kind]}</span> {t(`kinds.${kind}`)}
              {count > 0 && <span className="opacity-60 tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Edge type chips — every relation verb is toggleable, with live counts. */}
      <SectionHeader
        label={t("edgeTypes")}
        onAll={() => filters.setAllEdgeTypes(true)}
        onNone={() => filters.setAllEdgeTypes(false)}
        allLabel={t("all")}
        noneLabel={t("none")}
      />
      <div className="flex flex-wrap gap-1 mb-3">
        {ALL_EDGE_TYPES.map((type) => {
          const active = filters.visibleEdgeTypes.has(type);
          const color = EDGE_STYLES[type]?.color ?? "#7c3aed";
          const count = filters.edgeTypeCounts[type] ?? 0;
          return (
            <button
              key={type}
              onClick={() => filters.toggleEdgeType(type)}
              aria-pressed={active}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium border transition-all hover:brightness-125"
              style={{
                borderColor: active ? `${color}50` : "#27272a",
                backgroundColor: active ? `${color}1f` : "transparent",
                color: active ? color : "#52525b",
                opacity: count === 0 ? 0.45 : 1,
              }}
            >
              {t(`edgeLabels.${type}`)}
              {count > 0 && <span className="opacity-60 tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="h-px bg-zinc-800/60 my-3" />

      {/* Memory strength slider */}
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {t("memoryStrength")}
        </p>
        <span className="text-[10px] text-zinc-400 font-medium tabular-nums">
          ≥ {localStrength.toFixed(1)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={5}
        step={0.1}
        value={localStrength}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocalStrength(v); // instant thumb movement
          debouncedCommit(v); // analytics recompute only after 200ms idle
        }}
        className="w-full accent-violet-500 cursor-pointer"
        aria-label={t("memoryStrength")}
      />
      {/* Live visible count — turns red when the current filters hide
          EVERYTHING, so an empty canvas is never a mystery. */}
      <p
        className={`text-[10px] mt-1 tabular-nums ${
          nothingVisible ? "text-red-400 font-semibold" : "text-zinc-500"
        }`}
      >
        {t("visibleOf", { visible: visibleCount, total: filters.totalNodeCount })}
      </p>
      {nothingVisible && (
        <button
          onClick={filters.resetAll}
          className="mt-2 w-full text-[11px] font-semibold bg-violet-600/90 hover:bg-violet-500 text-white rounded-lg px-2 py-1.5 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <RotateCcw className="h-3 w-3" />
          {t("resetFilters")}
        </button>
      )}

      <div className="h-px bg-zinc-800/60 my-3" />

      {/* Focus depth — how many hops the ?focus= neighbourhood expands to.
          Only meaningful while a node is focused, but always visible so the
          operator can set it before double-clicking a node. */}
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {t("focusDepth")}
        </p>
        <span className="text-[10px] text-zinc-400 font-medium tabular-nums">
          {t("hops", { count: nav.depth })}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={3}
        step={1}
        value={nav.depth}
        onChange={(e) => nav.setDepth(Number(e.target.value))}
        className="w-full accent-violet-500 cursor-pointer"
        aria-label={t("focusDepth")}
      />

      <div className="h-px bg-zinc-800/60 my-3" />

      {/* Find-path mode — arm, then click two entities to highlight the
          shortest path between them. */}
      <button
        onClick={nav.toggleFindPath}
        aria-pressed={nav.findPathMode}
        className={
          "w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors " +
          (nav.findPathMode
            ? "bg-violet-600 text-white hover:bg-violet-500"
            : "bg-zinc-900/80 border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700")
        }
      >
        <Route className="h-3.5 w-3.5" />
        {nav.findPathMode ? t("findPath.active") : t("findPath.start")}
      </button>
      {nav.findPathMode && (
        <p className="text-[10px] text-zinc-500 mt-1.5 leading-relaxed">
          {!nav.pathFrom
            ? t("findPath.pickFrom")
            : !nav.pathTo
              ? t("findPath.pickTo")
              : t("findPath.done")}
        </p>
      )}

      <div className="h-px bg-zinc-800/60 my-3" />

      {/* As-of — reconstruct the graph at a past instant. Empty = live/now. */}
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {t("asOf")}
        </p>
        {nav.asOf && (
          <button
            onClick={() => nav.setAsOf(null)}
            className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors inline-flex items-center gap-1"
          >
            <GitBranchPlus className="h-3 w-3" />
            {t("asOfNow")}
          </button>
        )}
      </div>
      <input
        type="datetime-local"
        value={nav.asOf ? nav.asOf.slice(0, 16) : ""}
        onChange={(e) =>
          nav.setAsOf(e.target.value ? new Date(e.target.value).toISOString() : null)
        }
        className="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-700 [color-scheme:dark]"
        aria-label={t("asOf")}
      />
    </div>
  );
}
