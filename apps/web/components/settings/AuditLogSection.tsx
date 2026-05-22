"use client";

import { useEffect, useState } from "react";
import { Loader2, ScrollText, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const ACTION_TONE: Record<string, string> = {
  delete: "text-red-300 bg-red-500/10 border-red-500/30",
  remove: "text-red-300 bg-red-500/10 border-red-500/30",
  revoke: "text-red-300 bg-red-500/10 border-red-500/30",
  create: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  update: "text-blue-300 bg-blue-500/10 border-blue-500/30",
  takeover: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  role_change: "text-violet-300 bg-violet-500/10 border-violet-500/30",
};

function actionTone(action: string): string {
  const verb = action.split(".").pop() ?? "";
  return (
    ACTION_TONE[verb] ?? "text-body bg-zinc-500/10 border-zinc-500/30"
  );
}

/**
 * Audit log viewer. Read-only — un audit log mutable no es un audit log.
 * Filtrado mínimo client-side; si hace falta más profundo, migrar a server.
 */
export function AuditLogSection() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/audit-logs?limit=200");
    setLoading(false);
    if (r.ok) setRows(await r.json());
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = (rows ?? []).filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      r.action.toLowerCase().includes(q) ||
      r.resource.toLowerCase().includes(q) ||
      (r.resourceId ?? "").toLowerCase().includes(q) ||
      (r.userId ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="audit-filter" className="sr-only">
          Filtrar audit log
        </label>
        <input
          id="audit-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por action, resource, id…"
          className="input flex-1"
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Recargar audit log"
          className="btn-secondary"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-6 text-xs text-muted">
          <ScrollText className="h-4 w-4" />
          {rows.length === 0 ? "Sin actividad registrada todavía." : "Sin matches."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <ul>
            {filtered.map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[110px_1fr_auto] items-start gap-3 border-b border-white/[0.04] bg-card px-3 py-2 text-xs last:border-b-0"
              >
                <span
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                    actionTone(r.action)
                  )}
                >
                  {r.action}
                </span>
                <div className="min-w-0">
                  <div className="text-body">
                    {r.resource}
                    {r.resourceId && (
                      <span className="font-mono text-[10px] text-muted">
                        {" "}
                        · {r.resourceId.slice(0, 12)}…
                      </span>
                    )}
                  </div>
                  {(r.before || r.after) && (
                    <details className="mt-0.5 text-[10px] text-muted">
                      <summary className="cursor-pointer hover:text-body">
                        ver diff
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[10px]">
                        {JSON.stringify(
                          { before: r.before, after: r.after },
                          null,
                          2
                        )}
                      </pre>
                    </details>
                  )}
                </div>
                <span className="whitespace-nowrap text-[10px] text-faint">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
