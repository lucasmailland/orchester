"use client";
// Feature 2 — conflict resolver. Shows contradicting fact pairs from
// judge() grouped by subject. Each pair offers four actions: keep factA
// (supersede_b), keep factB (supersede_a), keep both (not a conflict), or
// merge into one fact. Hovering a pair asks the graph to flash its edge.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useConflicts } from "@/lib/hooks/use-conflicts";
import { groupConflictsBySubject } from "@/lib/curation/group-conflicts";
import type { ConflictPair, ResolveConflictInput } from "@mnemo-ai/client-ts";

export function ConflictResolverPanel({
  open,
  onClose,
  onHoverPair,
  onResolved,
}: {
  open: boolean;
  onClose: () => void;
  /** relationId or null — lets BrainGraph emphasise the matching edge. */
  onHoverPair?: (relationId: string | null) => void;
  onResolved?: () => void;
}) {
  const t = useTranslations("brain.curation");
  const { pairs, isLoading, error, resolve } = useConflicts();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mergeFor, setMergeFor] = useState<string | null>(null);
  const [mergeText, setMergeText] = useState("");
  const groups = groupConflictsBySubject(pairs);

  async function act(p: ConflictPair, input: ResolveConflictInput) {
    setBusyId(p.relationId);
    try {
      await resolve(p.relationId, input);
      setMergeFor(null);
      setMergeText("");
      onResolved?.();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      aria-hidden={!open}
      className="absolute top-4 right-4 bottom-4 w-96 bg-[#0c0c10]/95 backdrop-blur-xl border border-zinc-800/80 rounded-2xl shadow-2xl shadow-black/60 z-20 overflow-y-auto transition-all duration-200 ease-out"
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
        <h3 className="text-base font-bold text-zinc-50">{t("conflicts.title")}</h3>
        <p className="text-xs text-zinc-400 mt-0.5">{t("conflicts.subtitle")}</p>
      </div>

      <div className="p-4 space-y-4">
        {isLoading && <p className="text-xs text-zinc-600 animate-pulse">{t("loading")}</p>}
        {error && <p className="text-xs text-red-400/80">{t("error")}</p>}
        {!isLoading && !error && pairs.length === 0 && (
          <p className="text-xs text-zinc-600">{t("conflicts.empty")}</p>
        )}

        {groups.map((g) => (
          <div key={g.subject || "_ungrouped"} className="space-y-2">
            {g.subject && (
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {g.subject}{" "}
                <span className="text-zinc-600 normal-case tracking-normal">
                  ({g.pairs.length})
                </span>
              </p>
            )}
            {g.pairs.map((p) => (
              <div
                key={p.relationId}
                onMouseEnter={() => onHoverPair?.(p.relationId)}
                onMouseLeave={() => onHoverPair?.(null)}
                className="bg-zinc-900/60 border border-red-900/40 rounded-lg p-3 space-y-2"
              >
                <div className="space-y-1.5">
                  <p className="text-xs text-zinc-300 leading-relaxed border-l-2 border-amber-500/60 pl-2">
                    A · {p.factA.statement}
                  </p>
                  <p className="text-xs text-zinc-300 leading-relaxed border-l-2 border-cyan-500/60 pl-2">
                    B · {p.factB.statement}
                  </p>
                </div>
                {mergeFor === p.relationId ? (
                  <div className="space-y-2">
                    <textarea
                      value={mergeText}
                      onChange={(e) => setMergeText(e.target.value)}
                      placeholder={t("conflicts.mergePlaceholder")}
                      rows={2}
                      className="w-full text-xs bg-zinc-950/60 border border-zinc-800 rounded-md px-2 py-1.5 text-zinc-200 resize-none focus:border-violet-600 outline-none"
                    />
                    <div className="flex gap-1.5">
                      <button
                        disabled={busyId === p.relationId || mergeText.trim().length === 0}
                        onClick={() =>
                          act(p, { action: "merge", mergedStatement: mergeText.trim() })
                        }
                        className="flex-1 text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-md px-2 py-1 transition-colors"
                      >
                        {t("conflicts.confirmMerge")}
                      </button>
                      <button
                        onClick={() => {
                          setMergeFor(null);
                          setMergeText("");
                        }}
                        className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 px-2 py-1"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        ["conflicts.keepA", { action: "supersede_b" } as const],
                        ["conflicts.keepB", { action: "supersede_a" } as const],
                        ["conflicts.keepBoth", { action: "keep_both" } as const],
                      ] as const
                    ).map(([key, input]) => (
                      <button
                        key={key}
                        disabled={busyId === p.relationId}
                        onClick={() => act(p, input)}
                        className="text-[11px] font-semibold bg-zinc-800/80 hover:bg-zinc-700/80 disabled:opacity-50 text-zinc-200 border border-zinc-700/60 rounded-md px-2 py-1 transition-colors"
                      >
                        {t(key)}
                      </button>
                    ))}
                    <button
                      disabled={busyId === p.relationId}
                      onClick={() => setMergeFor(p.relationId)}
                      className="text-[11px] font-semibold bg-violet-600/20 hover:bg-violet-600/30 disabled:opacity-50 text-violet-200 border border-violet-700/40 rounded-md px-2 py-1 transition-colors"
                    >
                      {t("conflicts.merge")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
