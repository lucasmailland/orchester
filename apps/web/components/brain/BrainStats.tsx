"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { Brain, Pin, Trash2, GitMerge, Sparkles } from "lucide-react";

interface Stats {
  totals: {
    total_active: number;
    total_forgotten: number;
    total_merged: number;
    total_pinned: number;
    total_recalls: number;
    avg_confidence: number;
    avg_relevance: number;
  };
  byKind: Array<{ kind: string; n: number }>;
  topSubjects: Array<{ subject: string; n: number }>;
}

const fetcher = async (u: string) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
};

const KIND_COLORS: Record<string, string> = {
  preference: "bg-violet-500/15 text-violet-300",
  trait: "bg-blue-500/15 text-blue-300",
  event: "bg-emerald-500/15 text-emerald-300",
  relationship: "bg-pink-500/15 text-pink-300",
  skill: "bg-amber-500/15 text-amber-300",
  concern: "bg-red-500/15 text-red-300",
  other: "bg-slate-500/15 text-slate-300",
};

export function BrainStats() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug;
  const { data, error } = useSWR<Stats>(
    slug ? `/api/workspaces/${slug}/brain/stats` : null,
    fetcher
  );

  if (error || !data) return null;

  const tiles = [
    {
      label: "Active facts",
      value: data.totals.total_active,
      icon: Brain,
      tone: "text-violet-400",
    },
    { label: "Pinned", value: data.totals.total_pinned, icon: Pin, tone: "text-amber-400" },
    { label: "Merged", value: data.totals.total_merged, icon: GitMerge, tone: "text-blue-400" },
    {
      label: "Forgotten",
      value: data.totals.total_forgotten,
      icon: Trash2,
      tone: "text-muted",
    },
    {
      label: "Total recalls",
      value: data.totals.total_recalls,
      icon: Sparkles,
      tone: "text-emerald-400",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="rounded-xl border border-line bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-faint">{t.label}</span>
                <Icon className={`h-3.5 w-3.5 ${t.tone}`} />
              </div>
              <div className="mt-2 text-2xl font-bold text-strong">{t.value.toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            By kind
          </h3>
          <ul className="space-y-1.5">
            {data.byKind.length === 0 ? (
              <li className="text-xs text-faint">No facts yet</li>
            ) : (
              data.byKind.map((row) => (
                <li key={row.kind} className="flex items-center justify-between">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] uppercase ${KIND_COLORS[row.kind] ?? KIND_COLORS["other"]}`}
                  >
                    {row.kind}
                  </span>
                  <span className="text-xs font-medium text-strong">{row.n}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-line bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Top subjects
          </h3>
          <ul className="space-y-1.5">
            {data.topSubjects.length === 0 ? (
              <li className="text-xs text-faint">No facts yet</li>
            ) : (
              data.topSubjects.slice(0, 8).map((row) => (
                <li key={row.subject} className="flex items-center justify-between">
                  <span className="truncate text-xs text-body" title={row.subject}>
                    {row.subject}
                  </span>
                  <span className="ml-2 text-xs font-medium text-strong">{row.n}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-faint">
        <span>
          Avg confidence:{" "}
          <span className="font-semibold text-body">
            {(data.totals.avg_confidence * 100).toFixed(0)}%
          </span>
        </span>
        <span>·</span>
        <span>
          Avg relevance:{" "}
          <span className="font-semibold text-body">
            {(data.totals.avg_relevance * 100).toFixed(0)}%
          </span>
        </span>
      </div>
    </div>
  );
}
