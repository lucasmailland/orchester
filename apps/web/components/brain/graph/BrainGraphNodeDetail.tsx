"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { X, Target, ArrowRight } from "lucide-react";
import { Button } from "@heroui/react";
import type { GraphNode } from "@orchester/mnemosyne";
import { ENTITY_KIND_COLOR } from "@orchester/mnemosyne";

const KIND_LABELS: Record<string, string> = {
  person: "Person",
  organization: "Org",
  project: "Project",
  concept: "Concept",
  place: "Place",
  other: "Other",
  episode: "Episode",
  decision: "Decision",
};
const KIND_ICONS: Record<string, string> = {
  person: "●",
  organization: "⬡",
  project: "▣",
  concept: "◆",
  place: "⬠",
  other: "●",
  episode: "▶",
  decision: "◆",
};

interface Props {
  node: GraphNode | null;
  onClose: () => void;
}

export function BrainGraphNodeDetail({ node, onClose }: Props) {
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";
  const isOpen = node != null;
  const kind = node?.entityKind ?? node?.kind ?? "other";
  const color = ENTITY_KIND_COLOR[kind] ?? "#52525b";
  const strengthPct = Math.round(((node?.avgMemoryStrength ?? 0) / 5.0) * 100);

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-[272px] bg-[#111113] border-l border-zinc-800 z-20 overflow-y-auto transition-transform duration-200 ease-out"
      style={{ transform: isOpen ? "translateX(0)" : "translateX(100%)" }}
    >
      {node && (
        <>
          {/* Header */}
          <div className="p-4 border-b border-zinc-800/60 sticky top-0 bg-[#111113] z-10">
            <button
              onClick={onClose}
              className="float-right text-zinc-500 hover:text-zinc-200 transition-colors mt-0.5"
            >
              <X className="h-4 w-4" />
            </button>
            <div
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border mb-2"
              style={{ borderColor: `${color}40`, backgroundColor: `${color}18`, color }}
            >
              <span>{KIND_ICONS[kind]}</span>
              {KIND_LABELS[kind]}
            </div>
            <h3 className="text-base font-bold text-zinc-50 mb-1 pr-6">{node.label}</h3>
            {node.description && (
              <p className="text-xs text-zinc-400 leading-relaxed">{node.description}</p>
            )}
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            {/* Memory Strength */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                Memory Strength
              </p>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-700 to-violet-400 transition-all duration-500"
                  style={{ width: `${strengthPct}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>{node.avgMemoryStrength.toFixed(1)} / 5.0</span>
                {node.avgMemoryStrength > 3 && (
                  <span className="text-violet-400">↑ potentiating</span>
                )}
              </div>
            </div>

            {/* Fact count */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                Facts
              </p>
              <p className="text-sm text-zinc-300">{node.factCount} active facts</p>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-1">
              {node.kind === "entity" && (
                <Button
                  as={Link}
                  href={`/${locale}/${ws}/brain/graph?focus=${node.id}`}
                  size="sm"
                  variant="flat"
                  startContent={<Target className="h-3.5 w-3.5" />}
                  className="w-full justify-start bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-violet-700 hover:text-violet-300 transition-colors"
                >
                  Focus local graph
                </Button>
              )}
              <Button
                as={Link}
                href={`/${locale}/${ws}/brain`}
                size="sm"
                variant="flat"
                startContent={<ArrowRight className="h-3.5 w-3.5" />}
                className="w-full justify-start bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-violet-700 hover:text-violet-300 transition-colors"
              >
                View all facts
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
