"use client";

import { useEffect, useState } from "react";
import { Brain, Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface MemoryRow {
  id: string;
  scope: "global" | "conversation" | "employee";
  data: Record<string, unknown>;
  conversationId: string | null;
  employeeId: string | null;
  updatedAt: string;
}

const SCOPE_LABEL: Record<MemoryRow["scope"], string> = {
  global: "Global",
  conversation: "Conversación",
  employee: "Por usuario",
};

const SCOPE_COLOR: Record<MemoryRow["scope"], string> = {
  global: "text-violet-700 dark:text-violet-300 bg-violet-500/15",
  conversation: "text-blue-700 dark:text-blue-300 bg-blue-500/15",
  employee: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/15",
};

export function MemoryPanel({ agentId }: { agentId: string }) {
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<MemoryRow["scope"]>("global");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/agents/${agentId}/memory`);
    if (r.ok) setRows(await r.json());
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function add() {
    if (!key.trim() || !value.trim()) return toast.error("key + value requeridos");
    setBusy(true);
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {}
    const r = await fetch(`/api/agents/${agentId}/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, key, value: parsed }),
    });
    setBusy(false);
    if (r.ok) {
      toast.success("Guardado");
      setKey("");
      setValue("");
      load();
    } else toast.error("Error");
  }

  async function removeKey(row: MemoryRow, k: string) {
    const params = new URLSearchParams({ scope: row.scope, key: k });
    if (row.conversationId) params.set("conversationId", row.conversationId);
    if (row.employeeId) params.set("employeeId", row.employeeId);
    await fetch(`/api/agents/${agentId}/memory?${params}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-body">
        <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" /> Memoria persistente
      </div>
      <p className="mb-3 text-[11px] text-muted">
        El agente puede leer/escribir estas memorias a través de las tools{" "}
        <code className="rounded bg-elevated px-1 font-mono">memory_get</code> /{" "}
        <code className="rounded bg-elevated px-1 font-mono">memory_set</code>. También se inyectan
        automáticamente en el system prompt al inicio de cada conversación.
      </p>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted">Sin memorias guardadas todavía.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-line bg-elevated p-3"
            >
              <div className="mb-1.5 flex items-center gap-2 text-[11px]">
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${SCOPE_COLOR[row.scope]}`}
                >
                  {SCOPE_LABEL[row.scope]}
                </span>
                {row.conversationId && (
                  <span className="font-mono text-[10px] text-muted">
                    conv: {row.conversationId.slice(0, 8)}
                  </span>
                )}
                {row.employeeId && (
                  <span className="font-mono text-[10px] text-muted">
                    emp: {row.employeeId.slice(0, 8)}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-faint">
                  {new Date(row.updatedAt).toLocaleString()}
                </span>
              </div>
              <ul className="space-y-1 text-xs">
                {Object.entries(row.data).map(([k, v]) => (
                  <li key={k} className="flex items-start gap-2">
                    <span className="font-mono text-muted">{k}:</span>
                    <span className="flex-1 break-all text-body">
                      {typeof v === "string" ? v : JSON.stringify(v)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeKey(row, k)}
                      className="text-muted hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {(["global", "conversation", "employee"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={
                scope === s
                  ? "rounded-md bg-violet-500/25 px-2 py-1 text-violet-700 dark:text-violet-200"
                  : "rounded-md border border-line px-2 py-1 text-muted hover:text-body"
              }
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="key (ej. preferred_language)"
            className="flex-1 rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='value (JSON o texto)'
            className="flex-[2] rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || !key.trim() || !value.trim()}
            className="flex items-center gap-1 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}{" "}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
