"use client";
// Feature 1 — relation judgment queue. Lists relations with
// judgmentStatus='pending' and lets a curator apply a verb + confidence.
// Styling mirrors BrainGraphNodeDetail.tsx (floating right panel).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Check } from "lucide-react";
import { useRelationQueue } from "@/lib/hooks/use-relation-queue";
import { RelationVerbPicker } from "./RelationVerbPicker";
import type { RelationVerbLiteral } from "@/lib/mnemo/relation-verbs";

export function RelationJudgePanel({
  open,
  onClose,
  onJudged,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful judge so the graph can revalidate edges. */
  onJudged?: () => void;
}) {
  const t = useTranslations("brain.curation");
  const { relations, isLoading, error, judge } = useRelationQueue();
  const [draftVerb, setDraftVerb] = useState<Record<string, RelationVerbLiteral>>({});
  const [draftConf, setDraftConf] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <div
      aria-hidden={!open}
      className="absolute top-4 right-4 bottom-4 w-80 bg-[#0c0c10]/95 backdrop-blur-xl border border-zinc-800/80 rounded-2xl shadow-2xl shadow-black/60 z-20 overflow-y-auto transition-all duration-200 ease-out"
      style={{
        transform: open ? "translateX(0)" : "translateX(110%)",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <div className="p-4 border-b border-zinc-800/60 sticky top-0 z-10 bg-[#0c0c10f2] backdrop-blur-xl rounded-t-2xl">
        <button
          aria-label="Close"
          onClick={onClose}
          className="float-right text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <h3 className="text-base font-bold text-zinc-50">{t("judge.title")}</h3>
        <p className="text-xs text-zinc-400 mt-0.5">{t("judge.subtitle")}</p>
      </div>

      <div className="p-4 space-y-3">
        {isLoading && <p className="text-xs text-zinc-600 animate-pulse">{t("loading")}</p>}
        {error && <p className="text-xs text-red-400/80">{t("error")}</p>}
        {!isLoading && !error && relations.length === 0 && (
          <p className="text-xs text-zinc-600">{t("judge.empty")}</p>
        )}

        {relations.map((rel) => {
          const verb = draftVerb[rel.id] ?? (rel.relation as RelationVerbLiteral);
          const conf = draftConf[rel.id] ?? rel.confidence ?? 0.7;
          return (
            <div
              key={rel.id}
              className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3 space-y-2.5"
            >
              <p className="text-[11px] text-zinc-400 leading-relaxed tabular-nums">
                <span className="text-zinc-300">{rel.sourceKind}</span>:{rel.sourceId.slice(0, 10)}…
                {" → "}
                <span className="text-zinc-300">{rel.targetKind}</span>:{rel.targetId.slice(0, 10)}…
              </p>
              <RelationVerbPicker
                value={verb}
                onChange={(v) => setDraftVerb((m) => ({ ...m, [rel.id]: v }))}
              />
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={conf}
                  onChange={(e) =>
                    setDraftConf((m) => ({ ...m, [rel.id]: Number(e.target.value) }))
                  }
                  className="flex-1 accent-violet-500"
                />
                <span className="text-[11px] text-zinc-500 tabular-nums w-9 text-right">
                  {Math.round(conf * 100)}%
                </span>
              </div>
              <button
                type="button"
                disabled={busyId === rel.id}
                onClick={async () => {
                  setBusyId(rel.id);
                  try {
                    await judge(rel.id, { relation: verb, confidence: conf });
                    onJudged?.();
                  } finally {
                    setBusyId(null);
                  }
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                {t("judge.apply")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
