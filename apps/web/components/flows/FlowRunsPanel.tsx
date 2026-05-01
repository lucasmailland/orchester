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
    <div className="absolute right-0 top-0 z-30 flex h-full w-[420px] flex-col border-l border-white/[0.06] bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-zinc-200">
          <History className="h-4 w-4" /> Ejecuciones
        </span>
        <button onClick={onClose} type="button" className="text-zinc-500 hover:text-zinc-200">
          <X className="h-4 w-4" />
        </button>
      </div>
      {!selected ? (
        <div className="flex-1 overflow-y-auto p-3">
          {runs.length === 0 && (
            <div className="text-xs text-zinc-500">Aún no hubo ejecuciones.</div>
          )}
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => pickRun(r)}
              className="mb-1.5 flex w-full items-center justify-between rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2 text-left text-xs hover:bg-zinc-900"
            >
              <div>
                <div className="text-zinc-200">{r.triggerSource ?? "trigger"}</div>
                <div className="text-[10px] text-zinc-500">
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
                      : "text-zinc-500"
                  }
                >
                  {r.status}
                </span>
                <ChevronRight className="h-3 w-3 text-zinc-600" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mb-2 text-[11px] text-zinc-500 hover:text-zinc-200"
          >
            ← Volver
          </button>
          <div className="mb-3 rounded-lg border border-white/[0.06] bg-zinc-900/40 p-3 text-xs">
            <div className="text-zinc-200">{selected.run.status}</div>
            <div className="text-[10px] text-zinc-500">
              {new Date(selected.run.startedAt).toLocaleString()}
            </div>
            {selected.run.error && (
              <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300">
                {selected.run.error}
              </div>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Pasos</div>
          {selected.steps.map((s) => (
            <div
              key={s.id}
              className="mt-1.5 rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2 text-[11px]"
            >
              <div className="flex items-center justify-between">
                <span className="text-zinc-200">{s.nodeType}</span>
                <span
                  className={
                    s.status === "succeeded"
                      ? "text-emerald-400"
                      : s.status === "failed"
                      ? "text-red-400"
                      : "text-zinc-500"
                  }
                >
                  {s.status}
                </span>
              </div>
              {s.error && <div className="mt-1 text-red-300">{s.error}</div>}
              {s.output != null && (
                <pre className="mt-1 max-h-32 overflow-y-auto rounded bg-black/40 p-2 font-mono text-[10px] text-zinc-300">
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
