"use client";

import { useEffect, useState } from "react";
import { History, X, ChevronRight } from "lucide-react";

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
          <History className="h-4 w-4" /> Ejecuciones
        </span>
        <button onClick={onClose} type="button" className="text-muted hover:text-body">
          <X className="h-4 w-4" />
        </button>
      </div>
      {!selected ? (
        <div className="flex-1 overflow-y-auto p-3">
          {runs.length === 0 && (
            <div className="text-xs text-muted">Aún no hubo ejecuciones.</div>
          )}
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => pickRun(r)}
              className="mb-1.5 flex w-full items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-left text-xs hover:bg-zinc-900"
            >
              <div>
                <div className="text-body">{r.triggerSource ?? "trigger"}</div>
                <div className="text-[10px] text-muted">
                  {new Date(r.startedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={
                    r.status === "succeeded"
                      ? "text-emerald-400"
                      : r.status === "failed"
                      ? "text-red-400"
                      : r.status === "running"
                      ? "text-amber-400"
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
            ← Volver
          </button>
          <div className="mb-3 rounded-lg border border-line bg-card p-3 text-xs">
            <div className="text-body">{selected.run.status}</div>
            <div className="text-[10px] text-muted">
              {new Date(selected.run.startedAt).toLocaleString()}
            </div>
            {selected.run.error && (
              <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300">
                {selected.run.error}
              </div>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Pasos</div>
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
                      ? "text-emerald-400"
                      : s.status === "failed"
                      ? "text-red-400"
                      : "text-muted"
                  }
                >
                  {s.status}
                </span>
              </div>
              {s.error && <div className="mt-1 text-red-300">{s.error}</div>}
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
