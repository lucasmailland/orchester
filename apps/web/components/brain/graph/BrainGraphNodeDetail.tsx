"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { X, Target, ArrowRight, Pin } from "lucide-react";
import { Button } from "@heroui/react";
import type { GraphNode } from "@/lib/memory/graph-canvas";
import { ENTITY_KIND_COLOR } from "@/lib/memory/graph-canvas";
import { useEntityFacts } from "@/lib/hooks/use-entity-facts";

const KIND_ICONS: Record<string, string> = {
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
  node: GraphNode | null;
  /** Visible-graph degree of the node — computed by BrainGraph's adjacency. */
  degree: number;
  onClose: () => void;
}

export function BrainGraphNodeDetail({ node, degree, onClose }: Props) {
  const t = useTranslations("brain.graph");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";
  const isOpen = node != null;
  const kind = node?.entityKind ?? node?.kind ?? "other";
  const color = ENTITY_KIND_COLOR[kind] ?? "#52525b";
  const strengthPct = Math.round(((node?.avgMemoryStrength ?? 0) / 5.0) * 100);

  // The real memory content. Only entities carry linked facts —
  // episode/decision nodes pause the fetch (null key).
  const {
    facts,
    isLoading: factsLoading,
    error: factsError,
  } = useEntityFacts(node?.kind === "entity" ? node.id : null);

  return (
    <div
      aria-hidden={!isOpen}
      className="absolute top-4 right-4 bottom-4 w-72 bg-[#0c0c10]/95 backdrop-blur-xl border border-zinc-800/80 rounded-2xl shadow-2xl shadow-black/60 z-20 overflow-y-auto transition-all duration-200 ease-out"
      style={{
        transform: isOpen ? "translateX(0)" : "translateX(110%)",
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? "auto" : "none",
      }}
    >
      {node && (
        <>
          {/* Header — tinted with the entity's color so the panel visually
              belongs to the node that opened it. */}
          <div
            className="p-4 border-b border-zinc-800/60 sticky top-0 z-10 rounded-t-2xl backdrop-blur-xl"
            style={{
              background: `linear-gradient(180deg, ${color}14, transparent 90%), #0c0c10f2`,
            }}
          >
            <button
              aria-label="Close"
              onClick={onClose}
              className="float-right text-zinc-500 hover:text-zinc-200 transition-colors mt-0.5"
            >
              <X className="h-4 w-4" />
            </button>
            <div
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border mb-2"
              style={{ borderColor: `${color}40`, backgroundColor: `${color}18`, color }}
            >
              <span>{KIND_ICONS[kind]}</span>
              {t(`kinds.${kind}`)}
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
                {t("detail.memoryStrength")}
              </p>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-700 to-violet-400 transition-all duration-500"
                  style={{ width: `${strengthPct}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span className="tabular-nums">{node.avgMemoryStrength.toFixed(1)} / 5.0</span>
                {node.avgMemoryStrength > 3 && (
                  <span className="text-violet-400">{t("detail.potentiating")}</span>
                )}
              </div>
            </div>

            {/* Stats grid: facts / mentions / connections */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { label: t("detail.facts"), value: node.factCount },
                  { label: t("detail.mentions"), value: node.mentionCount },
                  { label: t("detail.connections"), value: degree },
                ] as const
              ).map(({ label, value }) => (
                <div
                  key={label}
                  className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-2 py-2 text-center"
                >
                  <p className="text-base font-bold text-zinc-100 tabular-nums leading-tight">
                    {value}
                  </p>
                  <p className="text-[9px] uppercase tracking-wider text-zinc-500 mt-0.5">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            {/* Memories — the actual fact statements linked to this entity.
                This is the content the node REPRESENTS; without it the panel
                is just metadata about an invisible thing. */}
            {node.kind === "entity" && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                  {t("detail.memories")}
                  {facts.length > 0 && (
                    <span className="ml-1.5 text-zinc-600 normal-case tracking-normal tabular-nums">
                      {facts.length}
                    </span>
                  )}
                </p>
                {factsLoading && (
                  <p className="text-xs text-zinc-600 animate-pulse">{t("detail.loadingFacts")}</p>
                )}
                {factsError != null && (
                  <p className="text-xs text-red-400/80">{t("detail.factsError")}</p>
                )}
                {!factsLoading && factsError == null && facts.length === 0 && (
                  <p className="text-xs text-zinc-600">{t("detail.noFacts")}</p>
                )}
                <div className="space-y-1.5">
                  {facts.map((f) => (
                    <div
                      key={f.id}
                      className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg px-2.5 py-2 hover:border-zinc-700/80 transition-colors"
                    >
                      <p className="text-xs text-zinc-300 leading-relaxed">{f.statement}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span
                          className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded border"
                          style={{
                            color,
                            borderColor: `${color}30`,
                            backgroundColor: `${color}10`,
                          }}
                        >
                          {f.kind}
                        </span>
                        <span className="text-[10px] text-zinc-600 tabular-nums">
                          {Math.round(f.confidence * 100)}%
                        </span>
                        {f.pinned && <Pin className="h-2.5 w-2.5 text-amber-400" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2 pt-1">
              {node.kind === "entity" && (
                <Button
                  as={Link}
                  href={`/${locale}/${ws}/brain/graph?focus=${node.id}`}
                  size="sm"
                  variant="flat"
                  startContent={<Target className="h-3.5 w-3.5" />}
                  className="w-full justify-start bg-zinc-800/80 border border-zinc-700/80 text-zinc-300 hover:border-violet-600 hover:text-violet-300 transition-colors"
                >
                  {t("detail.focusLocal")}
                </Button>
              )}
              <Button
                as={Link}
                href={`/${locale}/${ws}/brain`}
                size="sm"
                variant="flat"
                startContent={<ArrowRight className="h-3.5 w-3.5" />}
                className="w-full justify-start bg-zinc-800/80 border border-zinc-700/80 text-zinc-300 hover:border-violet-600 hover:text-violet-300 transition-colors"
              >
                {t("detail.viewFacts")}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
