"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Zap, Brain, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

interface Model {
  id: string;
  name: string;
  tier: "fast" | "smart" | "powerful";
  contextWindow: number;
}

interface ProviderGroup {
  provider: string;
  enabled: boolean;
  models: Model[];
}

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const TIER_ICON: Record<string, ReactNode> = {
  fast: <Zap className="h-3.5 w-3.5" />,
  smart: <Brain className="h-3.5 w-3.5" />,
  powerful: <Rocket className="h-3.5 w-3.5" />,
};

const PROVIDER_NAME: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
  azure_openai: "Azure OpenAI",
};

export function ModelPicker({ value, onChange }: Props) {
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((rows: Array<{ provider: string; enabled: boolean; models: Model[] }>) => {
        setGroups(
          (Array.isArray(rows) ? rows : []).map((r) => ({
            provider: r.provider,
            enabled: r.enabled,
            models: r.models ?? [],
          }))
        );
      })
      .catch(() => setGroups([]));
  }, []);

  const selected = groups.flatMap((g) => g.models).find((m) => m.id === value) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-xl border border-white/[0.08] bg-zinc-800/40 px-3.5 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800/60"
      >
        <span className="flex items-center gap-2">
          {selected ? TIER_ICON[selected.tier] : null}
          {selected ? selected.name : value || "Elegir modelo…"}
        </span>
        <ChevronDown className="h-4 w-4 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-white/[0.08] bg-zinc-900 shadow-xl">
          {groups.length === 0 && (
            <div className="px-3 py-3 text-xs text-zinc-500">
              Configurá un proveedor en Ajustes para ver modelos.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.provider}>
              <div className="border-b border-white/5 bg-zinc-900/80 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
                {PROVIDER_NAME[g.provider] ?? g.provider}
              </div>
              {g.models.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-zinc-600">
                  No hay modelos. Probá la conexión.
                </div>
              )}
              {g.models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-white/5",
                    m.id === value && "bg-violet-500/10 text-violet-200"
                  )}
                >
                  <span className="flex items-center gap-2 text-zinc-200">
                    {TIER_ICON[m.tier]} {m.name}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {Math.round(m.contextWindow / 1000)}k
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
