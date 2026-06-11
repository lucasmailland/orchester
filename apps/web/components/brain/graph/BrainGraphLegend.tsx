"use client";
import { useTranslations } from "next-intl";
import { ENTITY_KIND_COLOR } from "@/lib/memory/graph-canvas";

const NODE_LEGEND_KINDS = ["person", "organization", "project", "concept", "episode"] as const;

const EDGE_LEGEND = [
  { color: "#7c3aed", dashed: false, key: "related" },
  { color: "#dc2626", dashed: true, key: "conflict" },
  { color: "#52525b", dashed: true, key: "derived" },
] as const;

interface Props {
  /** 3D hides react-force-graph's stock nav hint (showNavInfo=false) and the
   *  legend carries our own, so the two never overlap. */
  is3D?: boolean;
}

export function BrainGraphLegend({ is3D }: Props) {
  const t = useTranslations("brain.graph");
  return (
    <div className="absolute bottom-4 left-4 z-10 bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 rounded-xl px-3 py-2 shadow-lg shadow-black/40 max-w-[calc(100%-2rem)]">
      <div className="flex items-center gap-3 text-[11px] text-zinc-400 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {t("legend.nodes")}
        </span>
        {NODE_LEGEND_KINDS.map((kind) => (
          <span key={kind} className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{
                background: ENTITY_KIND_COLOR[kind],
                boxShadow: `0 0 6px ${ENTITY_KIND_COLOR[kind]}80`,
              }}
            />
            {t(`kinds.${kind}`)}
          </span>
        ))}
        <span className="w-px h-3.5 bg-zinc-700/80" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {t("legend.edges")}
        </span>
        {EDGE_LEGEND.map(({ color, dashed, key }) => (
          <span key={key} className="flex items-center gap-1">
            <span
              className="inline-block w-4"
              style={{
                height: "1.5px",
                background: dashed ? "none" : color,
                borderTop: dashed ? `2px dashed ${color}` : "none",
              }}
            />
            {t(`legend.${key}`)}
          </span>
        ))}
        <span className="w-px h-3.5 bg-zinc-700/80" />
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: "radial-gradient(circle, #a78bfa40, transparent)" }}
          />
          {t("legend.memoryAura")}
        </span>
      </div>
      {is3D && (
        <p className="text-[10px] text-zinc-600 mt-1.5 pt-1.5 border-t border-zinc-800/60">
          {t("hint3d")}
        </p>
      )}
    </div>
  );
}
