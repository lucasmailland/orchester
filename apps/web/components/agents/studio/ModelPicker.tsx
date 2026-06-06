"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Zap, Brain, Rocket } from "lucide-react";
import { useTranslations } from "next-intl";
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

export function ModelPicker({ value, onChange }: Props) {
  const t = useTranslations("pages.agents.studio.modelPicker");
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [providerName, setProviderName] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Modelos de chat del catálogo, sólo de proveedores conectados.
    fetch("/api/ai/models?capability=chat")
      .then((r) => r.json())
      .then(
        (d: {
          models?: Array<{
            id: string;
            name: string;
            provider: string;
            tier: string | null;
            ctx: number | null;
          }>;
          providers?: Array<{ id: string; name: string }>;
        }) => {
          const names: Record<string, string> = {};
          for (const p of d.providers ?? []) names[p.id] = p.name;
          setProviderName(names);
          const byProvider: Record<string, Model[]> = {};
          for (const m of d.models ?? []) {
            (byProvider[m.provider] ??= []).push({
              id: m.id,
              name: m.name,
              tier: (m.tier as Model["tier"]) ?? "smart",
              contextWindow: m.ctx ?? 0,
            });
          }
          setGroups(
            Object.entries(byProvider).map(([provider, models]) => ({
              provider,
              enabled: true,
              models,
            }))
          );
        }
      )
      .catch(() => setGroups([]));
  }, []);

  const selected = groups.flatMap((g) => g.models).find((m) => m.id === value) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-[200px] items-center justify-between gap-2 rounded-xl border border-line bg-elevated px-3.5 py-2.5 text-sm text-strong hover:bg-elevated"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? TIER_ICON[selected.tier] : null}
          {/* truncate so a long id never visually cuts off the leading
              characters (e.g. ‘…de-sonnet-4-6’ for claude-sonnet-4-6).
              `min-w-0` on the parent lets the truncate kick in instead
              of stretching the dropdown trigger off-screen. */}
          <span className="truncate">{selected ? selected.name : value || t("pickModel")}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
          {groups.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted">{t("noConnected")}</div>
          )}
          {groups.map((g) => (
            <div key={g.provider}>
              <div className="border-b border-line bg-surface/80 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted">
                {providerName[g.provider] ?? g.provider}
              </div>
              {g.models.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-faint">{t("noModelsInProvider")}</div>
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
                    "flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-hover",
                    m.id === value && "bg-violet-500/10 text-violet-700 dark:text-violet-200"
                  )}
                >
                  <span className="flex items-center gap-2 text-body">
                    {TIER_ICON[m.tier]} {m.name}
                  </span>
                  {m.contextWindow > 0 && (
                    <span className="text-[10px] text-muted">
                      {Math.round(m.contextWindow / 1000)}k
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
