"use client";
// A small segmented control that selects which curation surface is open.
// Lives top-left so it never collides with the right-anchored panels.
import { useTranslations } from "next-intl";
import { Scale, AlertTriangle, Pencil, GitBranch } from "lucide-react";

export type CurationPanel = "judge" | "conflicts" | "draw" | "lineage" | null;

export function CurationToolbar({
  active,
  onSelect,
}: {
  active: CurationPanel;
  onSelect: (p: CurationPanel) => void;
}) {
  const t = useTranslations("brain.curation.toolbar");
  const items = [
    ["judge", Scale, t("judge")],
    ["conflicts", AlertTriangle, t("conflicts")],
    ["draw", Pencil, t("draw")],
    ["lineage", GitBranch, t("lineage")],
  ] as const;

  return (
    <div className="absolute top-16 left-4 z-10 flex rounded-lg bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 p-0.5 text-xs font-semibold shadow-lg shadow-black/40">
      {items.map(([id, Icon, label]) => (
        <button
          key={id}
          onClick={() => onSelect(active === id ? null : (id as CurationPanel))}
          title={label}
          className={
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors " +
            (active === id ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-100")
          }
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
