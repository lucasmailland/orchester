"use client";
// Feature 4 — decision lineage. Lists decisions and their supersedes chains.
// "Supersede" lets a curator mark an active decision as superseded by a
// newer one (a second decision picked from the list). Mirrors panel chrome.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { X, ArrowDown, GitBranch } from "lucide-react";
import { useDecisions } from "@/lib/hooks/use-decisions";

export function DecisionLineageSidebar({
  open,
  onClose,
  onSuperseded,
}: {
  open: boolean;
  onClose: () => void;
  onSuperseded?: () => void;
}) {
  const t = useTranslations("brain.curation");
  const { decisions, chains, isLoading, error, supersede } = useDecisions();
  const [supersedeFor, setSupersedeFor] = useState<string | null>(null);
  const [pickNewer, setPickNewer] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const activeDecisions = decisions.filter((d) => d.status === "active");

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
        <h3 className="text-base font-bold text-zinc-50 inline-flex items-center gap-1.5">
          <GitBranch className="h-4 w-4 text-violet-400" />
          {t("lineage.title")}
        </h3>
        <p className="text-xs text-zinc-400 mt-0.5">{t("lineage.subtitle")}</p>
      </div>

      <div className="p-4 space-y-4">
        {isLoading && <p className="text-xs text-zinc-600 animate-pulse">{t("loading")}</p>}
        {error && <p className="text-xs text-red-400/80">{t("error")}</p>}
        {!isLoading && !error && chains.length === 0 && (
          <p className="text-xs text-zinc-600">{t("lineage.empty")}</p>
        )}

        {chains.map((chain) => (
          <div
            key={chain.decisions[0]?.id ?? chain.decisions.length}
            className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3 space-y-2"
          >
            {chain.decisions.map((d, i) => (
              <div key={d.id}>
                {i > 0 && <ArrowDown className="h-3 w-3 text-zinc-600 my-1 mx-auto" />}
                <div
                  className={
                    "rounded-md px-2.5 py-2 border " +
                    (d.status === "active"
                      ? "border-violet-700/40 bg-violet-600/5"
                      : "border-zinc-800/60 bg-zinc-950/40 opacity-70")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-zinc-200 leading-tight">{d.title}</p>
                    <span
                      className={
                        "text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded " +
                        (d.status === "active"
                          ? "text-violet-300 bg-violet-600/15"
                          : "text-zinc-500 bg-zinc-800/60")
                      }
                    >
                      {t(`lineage.status.${d.status}`)}
                    </span>
                  </div>
                  {d.body && (
                    <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">{d.body}</p>
                  )}

                  {d.status === "active" &&
                    (supersedeFor === d.id ? (
                      <div className="mt-2 space-y-1.5">
                        <select
                          value={pickNewer}
                          onChange={(e) => setPickNewer(e.target.value)}
                          className="w-full text-[11px] bg-zinc-950/60 border border-zinc-800 rounded-md px-2 py-1 text-zinc-200 outline-none focus:border-violet-600"
                        >
                          <option value="">{t("lineage.pickReplacement")}</option>
                          {activeDecisions
                            .filter((c) => c.id !== d.id)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title}
                              </option>
                            ))}
                        </select>
                        <div className="flex gap-1.5">
                          <button
                            disabled={busy || !pickNewer}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await supersede(d.id, pickNewer);
                                setSupersedeFor(null);
                                setPickNewer("");
                                onSuperseded?.();
                              } finally {
                                setBusy(false);
                              }
                            }}
                            className="flex-1 text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-md px-2 py-1 transition-colors"
                          >
                            {t("lineage.confirm")}
                          </button>
                          <button
                            onClick={() => {
                              setSupersedeFor(null);
                              setPickNewer("");
                            }}
                            className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 px-2 py-1"
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSupersedeFor(d.id)}
                        className="mt-2 text-[11px] font-semibold text-violet-300 hover:text-violet-200 transition-colors"
                      >
                        {t("lineage.supersede")}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
