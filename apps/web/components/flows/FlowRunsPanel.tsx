"use client";

import { useEffect, useState } from "react";
import { History, X, ChevronRight, Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { isDryRunSource } from "@/lib/flows/dry-run";

interface Run {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  triggerSource: string | null;
  error: string | null;
}
interface Step {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  output: unknown;
  error: string | null;
  startedAt: string;
  // AI trace recorded on the step; all null for steps that did no AI work.
  agentId?: string | null;
  agentName?: string | null;
  model?: string | null;
  tokensUsed?: number | null;
  costUsd?: string | number | null;
}

function formatCost(cost: string | number): string {
  const n = Number(cost);
  return Number.isFinite(n) ? `$${n.toFixed(4)}` : "";
}

function DryRunBadge({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mt-0.5">
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
        {label}
      </span>
      {hint && <div className="mt-1 text-[10px] text-muted">{hint}</div>}
    </div>
  );
}

/** A step a dry run simulated: `{ dryRun: true, wouldCall: {...} }`. */
function isWouldCall(o: unknown): o is { dryRun: true; wouldCall: Record<string, unknown> } {
  return (
    typeof o === "object" &&
    o !== null &&
    (o as { dryRun?: unknown }).dryRun === true &&
    typeof (o as { wouldCall?: unknown }).wouldCall === "object"
  );
}

function describeWouldCall(w: Record<string, unknown>): string {
  if (typeof w.integrationId === "string") return `${w.integrationId} → ${String(w.action)}`;
  if (typeof w.method === "string") return `${w.method} ${String(w.url)}`;
  if (typeof w.channel === "string" || typeof w.to === "string") {
    return `${String(w.channel ?? "")} ${String(w.to ?? "")}`.trim();
  }
  return "";
}

export function FlowRunsPanel({
  flowId,
  open,
  onClose,
}: {
  flowId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("pages.flows.runs");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<{ run: Run; steps: Step[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/flows/${flowId}/runs`)
      .then((r) => r.json())
      .then((d) => setRuns(Array.isArray(d) ? d : []));
  }, [flowId, open]);

  async function pickRun(r: Run) {
    const detail = await fetch(`/api/flow-runs/${r.id}`).then((x) => x.json());
    setSelected(detail);
  }

  if (!open) return null;
  return (
    <div className="absolute right-0 top-0 z-30 flex h-full w-[420px] flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-body">
          <History className="h-4 w-4" /> {t("title")}
        </span>
        <button
          onClick={onClose}
          type="button"
          aria-label={t("closeAria")}
          className="text-muted hover:text-body"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {!selected ? (
        <div className="flex-1 overflow-y-auto p-3">
          {runs.length === 0 && <div className="text-xs text-muted">{t("noRuns")}</div>}
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => pickRun(r)}
              className="mb-1.5 flex w-full items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-left text-xs hover:bg-surface"
            >
              <div>
                <div className="text-body">{r.triggerSource ?? t("trigger")}</div>
                {isDryRunSource(r.triggerSource) && <DryRunBadge label={t("dryRunBadge")} />}
                <div className="text-[10px] text-muted">
                  {new Date(r.startedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={
                    r.status === "succeeded"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : r.status === "failed"
                        ? "text-red-600 dark:text-red-400"
                        : r.status === "running"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted"
                  }
                >
                  {r.status}
                </span>
                <ChevronRight className="h-3 w-3 text-faint" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mb-2 text-[11px] text-muted hover:text-body"
          >
            {t("back")}
          </button>
          <div className="mb-3 rounded-lg border border-line bg-card p-3 text-xs">
            <div className="text-body">{selected.run.status}</div>
            {isDryRunSource(selected.run.triggerSource) && (
              <DryRunBadge label={t("dryRunBadge")} hint={t("dryRunHint")} />
            )}
            <div className="text-[10px] text-muted">
              {new Date(selected.run.startedAt).toLocaleString()}
            </div>
            {selected.run.error && (
              <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-700 dark:text-red-300">
                {selected.run.error}
              </div>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted">{t("stepsHeading")}</div>
          {selected.steps.map((s) => (
            <div
              key={s.id}
              className="mt-1.5 rounded-lg border border-line bg-card px-3 py-2 text-[11px]"
            >
              <div className="flex items-center justify-between">
                <span className="text-body">{s.nodeType}</span>
                <span
                  className={
                    s.status === "succeeded"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : s.status === "failed"
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted"
                  }
                >
                  {s.status}
                </span>
              </div>
              {(s.agentName || s.agentId) && (
                <div className="mt-1 flex items-center gap-1 text-body">
                  <Bot className="h-3 w-3" aria-label={t("agentAria")} />
                  <span>{s.agentName ?? s.agentId}</span>
                </div>
              )}
              {s.model && (
                <div className="mt-0.5 text-[10px] text-muted">
                  {[
                    s.model,
                    s.tokensUsed != null ? t("tokens", { count: s.tokensUsed }) : null,
                    s.costUsd != null ? formatCost(s.costUsd) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
              {s.error && <div className="mt-1 text-red-700 dark:text-red-300">{s.error}</div>}
              {isWouldCall(s.output) && (
                <div className="mt-1 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-200">
                  <div className="font-medium">{t("wouldCall")}</div>
                  <div className="font-mono text-[10px]">
                    {describeWouldCall(s.output.wouldCall)}
                  </div>
                </div>
              )}
              {s.output != null && (
                <pre className="mt-1 max-h-32 overflow-y-auto rounded bg-black/40 p-2 font-mono text-[10px] text-body">
                  {JSON.stringify(s.output, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
