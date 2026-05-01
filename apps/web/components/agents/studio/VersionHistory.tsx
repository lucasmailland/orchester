"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw, Plus } from "lucide-react";

interface Version {
  id: string;
  systemPrompt: string;
  model: string;
  label: string | null;
  createdAt: string;
}

interface Props {
  agentId: string;
  current: {
    systemPrompt: string;
    model: string;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
  };
  onRestored: () => void;
}

export function VersionHistory({ agentId, current, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    const r = await fetch(`/api/agents/${agentId}/versions`);
    const j = await r.json();
    setVersions(Array.isArray(j) ? j : []);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function saveVersion() {
    setSaving(true);
    await fetch(`/api/agents/${agentId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemPrompt: current.systemPrompt,
        model: current.model,
        temperature: current.temperature,
        maxTokens: current.maxTokens,
        label: label.trim() || null,
      }),
    });
    setLabel("");
    setSaving(false);
    refresh();
  }

  async function restore(vid: string) {
    await fetch(`/api/agents/${agentId}/versions/${vid}/restore`, { method: "POST" });
    onRestored();
    refresh();
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-200">
        <History className="h-4 w-4 text-zinc-500" /> Historial de versiones
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Etiqueta (opcional)"
          className="flex-1 rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
        />
        <button
          onClick={saveVersion}
          disabled={saving}
          className="flex items-center gap-1 rounded-lg bg-violet-500/90 px-2.5 py-1.5 text-xs text-white hover:bg-violet-500 disabled:opacity-40"
          type="button"
        >
          <Plus className="h-3.5 w-3.5" /> Guardar versión
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-zinc-500">Cargando…</div>
      ) : versions.length === 0 ? (
        <div className="text-xs text-zinc-500">Aún no hay versiones guardadas.</div>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-800/30 px-3 py-2 text-xs"
            >
              <div>
                <div className="text-zinc-200">{v.label ?? "Sin etiqueta"}</div>
                <div className="text-[10px] text-zinc-500">
                  {new Date(v.createdAt).toLocaleString()} · {v.model}
                </div>
              </div>
              <button
                onClick={() => restore(v.id)}
                className="flex items-center gap-1 text-zinc-400 hover:text-violet-300"
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restaurar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
