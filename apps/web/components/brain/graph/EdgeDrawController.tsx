"use client";
// Feature 3 — manual edge drawing. When draw mode is on, BrainGraph sends
// each clicked node here (source first, then target). Pick a verb and POST
// a user-marked relation, then revalidate the graph.
import { useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { X, Pencil, ArrowRight } from "lucide-react";
import type { GraphNode } from "@/lib/memory/graph-canvas";
import { RelationVerbPicker } from "./RelationVerbPicker";
import { graphKindToRelationKind, type RelationVerbLiteral } from "@/lib/mnemo/relation-verbs";

export interface EdgeDrawState {
  active: boolean;
  source: GraphNode | null;
  target: GraphNode | null;
}

export function EdgeDrawController({
  state,
  onToggle,
  onClear,
  onCreated,
}: {
  state: EdgeDrawState;
  onToggle: () => void;
  onClear: () => void;
  /** Called after a relation is created so BrainGraph can mutate() the graph. */
  onCreated: () => void;
}) {
  const t = useTranslations("brain.curation");
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug ?? "";
  const [verb, setVerb] = useState<RelationVerbLiteral | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canCreate = state.source && state.target && verb && !busy;

  async function create() {
    if (!state.source || !state.target || !verb || !slug) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspaces/${slug}/brain/relations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceKind: graphKindToRelationKind(state.source.kind),
          sourceId: state.source.id,
          targetKind: graphKindToRelationKind(state.target.kind),
          targetId: state.target.id,
          relation: verb,
          confidence: 1,
        }),
      });
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      setVerb(null);
      onClear();
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  if (!state.active) {
    return (
      <button
        onClick={onToggle}
        className="absolute bottom-16 left-4 z-10 inline-flex items-center gap-1.5 text-[11px] font-semibold bg-[#0c0c10]/90 backdrop-blur-xl border border-zinc-800/80 text-zinc-300 hover:text-violet-300 rounded-lg px-3 py-1.5 shadow-lg shadow-black/40 transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        {t("draw.start")}
      </button>
    );
  }

  return (
    <div className="absolute bottom-16 left-4 z-10 w-72 bg-[#0c0c10]/95 backdrop-blur-xl border border-violet-700/50 rounded-2xl shadow-2xl shadow-black/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-violet-300">
          {t("draw.title")}
        </p>
        <button onClick={onToggle} aria-label="Close" className="text-zinc-500 hover:text-zinc-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="flex-1 truncate rounded-md bg-zinc-900/60 border border-zinc-800/60 px-2 py-1.5 text-zinc-300">
          {state.source?.label ?? t("draw.pickSource")}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-zinc-600 flex-shrink-0" />
        <span className="flex-1 truncate rounded-md bg-zinc-900/60 border border-zinc-800/60 px-2 py-1.5 text-zinc-300">
          {state.target?.label ?? t("draw.pickTarget")}
        </span>
      </div>

      <RelationVerbPicker value={verb} onChange={setVerb} label={t("draw.verb")} />

      {err && <p className="text-[11px] text-red-400/80">{t("error")}</p>}

      <div className="flex gap-1.5">
        <button
          disabled={!canCreate}
          onClick={create}
          className="flex-1 text-[11px] font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
        >
          {t("draw.create")}
        </button>
        <button
          onClick={onClear}
          className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 px-2 py-1.5"
        >
          {t("draw.reset")}
        </button>
      </div>
    </div>
  );
}
