"use client";
import { Search } from "lucide-react";
import { ENTITY_KIND_COLOR } from "@orchester/mnemosyne";
import type { GraphFiltersState } from "@/lib/hooks/use-graph-filters";

const NODE_CHIPS: { kind: string; label: string; icon: string }[] = [
  { kind: "person", label: "Person", icon: "●" },
  { kind: "organization", label: "Org", icon: "⬡" },
  { kind: "project", label: "Project", icon: "▣" },
  { kind: "concept", label: "Concept", icon: "◆" },
  { kind: "episode", label: "Episode", icon: "▶" },
];

const EDGE_CHIPS: { type: string; label: string; isConflict?: boolean }[] = [
  { type: "related", label: "related" },
  { type: "conflicts_with", label: "conflict", isConflict: true },
  { type: "derived_from", label: "derived" },
  { type: "part_of", label: "part_of" },
  { type: "member_of", label: "member" },
];

interface Props {
  filters: GraphFiltersState;
}

export function BrainGraphFilters({ filters }: Props) {
  return (
    <div className="absolute top-4 left-4 z-10 w-44 bg-[#111113f2] backdrop-blur-md border border-zinc-800 rounded-xl p-3.5">
      <p className="text-[10px] font-bold tracking-widest uppercase text-zinc-500 mb-2.5">Filter</p>

      {/* Search */}
      <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 mb-3">
        <Search className="h-3 w-3 text-zinc-500 flex-shrink-0" />
        <input
          aria-label="Search entities"
          className="bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none w-full"
          placeholder="Search entities…"
          value={filters.searchQuery}
          onChange={(e) => filters.setSearchQuery(e.target.value)}
        />
      </div>

      {/* Node type chips */}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
        Node types
      </p>
      <div className="flex flex-wrap gap-1 mb-3">
        {NODE_CHIPS.map(({ kind, label, icon }) => {
          const active = filters.visibleNodeKinds.has(kind);
          const color = ENTITY_KIND_COLOR[kind] ?? "#52525b";
          return (
            <button
              key={kind}
              onClick={() => filters.toggleNodeKind(kind)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border transition-opacity"
              style={{
                borderColor: `${color}40`,
                backgroundColor: `${color}18`,
                color,
                opacity: active ? 1 : 0.3,
              }}
            >
              <span>{icon}</span> {label}
            </button>
          );
        })}
      </div>

      {/* Edge type chips */}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
        Edge types
      </p>
      <div className="flex flex-wrap gap-1 mb-3">
        {EDGE_CHIPS.map(({ type, label, isConflict }) => {
          const active = filters.visibleEdgeTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => filters.toggleEdgeType(type)}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border transition-opacity"
              style={{
                borderColor: isConflict ? "#dc262640" : "#7c3aed40",
                backgroundColor: isConflict ? "#2d0a0a" : "#1e1b4b",
                color: isConflict ? "#f87171" : "#8b5cf6",
                opacity: active ? 1 : 0.3,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Memory strength slider */}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
        Memory strength
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
          aria-label="Minimum memory strength"
        />
        <span className="text-[10px] text-zinc-400 font-medium w-8 text-right">
          {filters.minMemoryStrength.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
