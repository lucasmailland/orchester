"use client";
import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ENTITY_KIND_COLOR, EDGE_STYLES } from "@/lib/memory/graph-canvas";
import { ALL_NODE_KINDS, ALL_EDGE_TYPES } from "@/lib/hooks/use-graph-filters";
import type { GraphFiltersState } from "@/lib/hooks/use-graph-filters";

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
}

export function BrainGraphFilters({ filters }: Props) {
  const t = useTranslations("brain.graph");
  const [collapsed, setCollapsed] = useState(false);

  // Count of non-default filters so the collapsed chip can signal "filters
  // active" without expanding.
  const activeCount =
    ALL_NODE_KINDS.length -
    filters.visibleNodeKinds.size +
    (ALL_EDGE_TYPES.length - filters.visibleEdgeTypes.size) +
    (filters.minMemoryStrength > 0 ? 1 : 0) +
    (filters.searchQuery.trim() ? 1 : 0);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        aria-label={t("showFilters")}
        title={t("showFilters")}
        className="absolute top-4 left-4 z-10 flex items-center gap-1.5 bg-[#111113f2] backdrop-blur-md border border-zinc-800 rounded-xl px-3 py-2 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
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
    <div className="absolute top-4 left-4 z-10 w-44 bg-[#111113f2] backdrop-blur-md border border-zinc-800 rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">
          {t("filter")}
        </p>
        <button
          onClick={() => setCollapsed(true)}
          aria-label={t("hideFilters")}
          title={t("hideFilters")}
          className="text-zinc-600 hover:text-zinc-300 transition-colors -mr-1 -mt-1 p-1"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 mb-3">
        <Search className="h-3 w-3 text-zinc-500 flex-shrink-0" />
        <input
          aria-label={t("searchPlaceholder")}
          className="bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none w-full"
          placeholder={t("searchPlaceholder")}
          value={filters.searchQuery}
          onChange={(e) => filters.setSearchQuery(e.target.value)}
        />
      </div>

      {/* Node type chips — every node kind is toggleable. */}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
        {t("nodeTypes")}
      </p>
      <div className="flex flex-wrap gap-1 mb-3">
        {ALL_NODE_KINDS.map((kind) => {
          const active = filters.visibleNodeKinds.has(kind);
          const color = ENTITY_KIND_COLOR[kind] ?? "#52525b";
          return (
            <button
              key={kind}
              onClick={() => filters.toggleNodeKind(kind)}
              aria-pressed={active}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border transition-opacity"
              style={{
                borderColor: `${color}40`,
                backgroundColor: `${color}18`,
                color,
                opacity: active ? 1 : 0.3,
              }}
            >
              <span>{KIND_ICON[kind]}</span> {t(`kinds.${kind}`)}
            </button>
          );
        })}
      </div>

      {/* Edge type chips — every relation verb is toggleable. */}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
        {t("edgeTypes")}
      </p>
      <div className="flex flex-wrap gap-1 mb-3">
        {ALL_EDGE_TYPES.map((type) => {
          const active = filters.visibleEdgeTypes.has(type);
          const color = EDGE_STYLES[type]?.color ?? "#7c3aed";
          return (
            <button
              key={type}
              onClick={() => filters.toggleEdgeType(type)}
              aria-pressed={active}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border transition-opacity"
              style={{
                borderColor: `${color}40`,
                backgroundColor: `${color}22`,
                color,
                opacity: active ? 1 : 0.3,
              }}
            >
              {t(`edgeLabels.${type}`)}
            </button>
          );
        })}
      </div>

      {/* Memory strength slider */}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
        {t("memoryStrength")}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={filters.minMemoryStrength}
          onChange={(e) => filters.setMinMemoryStrength(Number(e.target.value))}
          className="flex-1 accent-violet-600 cursor-pointer"
          aria-label={t("memoryStrength")}
        />
        <span className="text-[10px] text-zinc-400 font-medium w-8 text-right">
          {filters.minMemoryStrength.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
