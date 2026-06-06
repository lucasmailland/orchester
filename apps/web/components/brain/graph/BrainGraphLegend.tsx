"use client";
import { useTranslations } from "next-intl";
import { ENTITY_KIND_COLOR } from "@/lib/brain/graph-canvas";

const NODE_LEGEND_KINDS = ["person", "organization", "project", "concept", "episode"] as const;

const EDGE_LEGEND = [
  { color: "#7c3aed", dashed: false, key: "related" },
  { color: "#dc2626", dashed: true, key: "conflict" },
  { color: "#52525b", dashed: true, key: "derived" },
] as const;

export function BrainGraphLegend() {
  const t = useTranslations("brain.graph");
  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 bg-[#111113f2] backdrop-blur-md border border-zinc-800 rounded-lg px-3 py-2 text-[11px] text-zinc-400 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        {t("legend.nodes")}
      </span>
      {NODE_LEGEND_KINDS.map((kind) => (
        <span key={kind} className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: ENTITY_KIND_COLOR[kind] }}
          />
          {t(`kinds.${kind}`)}
        </span>
      ))}
      <span className="w-px h-3.5 bg-zinc-700" />
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
      <span className="w-px h-3.5 bg-zinc-700" />
      <span className="flex items-center gap-1">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ background: "radial-gradient(circle, #a78bfa40, transparent)" }}
        />
        {t("legend.memoryAura")}
      </span>
    </div>
  );
}
