"use client";

import { useEffect, useMemo, useState } from "react";

interface ModelOpt {
  id: string;
  name: string;
  provider: string;
  tier: string | null;
}
interface ProviderOpt {
  id: string;
  name: string;
  connected: boolean;
}

/**
 * Selector de modelo filtrado por capacidad. Muestra los modelos de los
 * proveedores conectados, agrupados por proveedor. Si no hay ninguno conectado,
 * guía a Ajustes. Reutilizado por el editor de agentes y los nodos de flujo.
 */
export function ModelPicker({
  capability,
  value,
  onChange,
  className,
}: {
  capability: string;
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
}) {
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [providers, setProviders] = useState<ProviderOpt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/ai/models?capability=${encodeURIComponent(capability)}`)
      .then((r) => (r.ok ? r.json() : { models: [], providers: [] }))
      .then((d) => {
        if (!alive) return;
        setModels(d.models ?? []);
        setProviders(d.providers ?? []);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [capability]);

  const grouped = useMemo(() => {
    const byProvider: Record<string, ModelOpt[]> = {};
    for (const m of models) (byProvider[m.provider] ??= []).push(m);
    const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
    return Object.entries(byProvider).map(([pid, ms]) => ({ providerId: pid, providerName: nameOf(pid), models: ms }));
  }, [models, providers]);

  const cls =
    className ??
    "w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-sm text-strong outline-none focus:border-violet-500/60";

  if (loading) {
    return <div className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-faint">Cargando modelos…</div>;
  }

  if (models.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-card p-2.5 text-[11px] text-muted">
        No tenés proveedores de IA conectados para esto. Andá a{" "}
        <a href="/settings" className="text-violet-600 dark:text-violet-400 hover:underline">Ajustes → IA</a>{" "}
        y conectá uno (OpenAI, Google, Replicate…).
      </div>
    );
  }

  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">Elegí un modelo…</option>
        {grouped.map((g) => (
          <optgroup key={g.providerId} label={g.providerName}>
            {g.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.tier ? ` · ${m.tier}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {/* valor fuera del catálogo (ej. id libre de agregador) sigue siendo válido */}
      {value && !models.some((m) => m.id === value) && (
        <p className="mt-1 text-[10px] text-faint">Modelo actual: <code className="font-mono">{value}</code></p>
      )}
    </>
  );
}
