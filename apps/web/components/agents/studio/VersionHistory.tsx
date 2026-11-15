"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

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
  const t = useTranslations("pages.agents.studio.versions");
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
    try {
      const r = await fetch(`/api/agents/${agentId}/versions`, {
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
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setLabel("");
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
      refresh();
    }
  }

  async function restore(vid: string) {
    try {
      const r = await fetch(`/api/agents/${agentId}/versions/${vid}/restore`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success(t("restored"));
      onRestored();
    } catch {
      toast.error(t("restoreError"));
    }
    refresh();
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-body">
        <History className="h-4 w-4 text-muted" /> {t("title")}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("labelPlaceholder")}
          className="flex-1 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
        />
        <button
          onClick={saveVersion}
          disabled={saving}
          className="flex items-center gap-1 rounded-lg bg-violet-500/90 px-2.5 py-1.5 text-xs text-white hover:bg-violet-500 disabled:opacity-40"
          type="button"
        >
          <Plus className="h-3.5 w-3.5" /> {t("saveVersion")}
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-muted">{t("loading")}</div>
      ) : versions.length === 0 ? (
        <div className="text-xs text-muted">{t("noVersions")}</div>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-line bg-elevated px-3 py-2 text-xs"
            >
              <div>
                <div className="text-body">{v.label ?? t("noLabel")}</div>
                <div className="text-[10px] text-muted">
                  {new Date(v.createdAt).toLocaleString()} · {v.model}
                </div>
              </div>
              <button
                onClick={() => restore(v.id)}
                className="flex items-center gap-1 text-muted hover:text-violet-700 dark:hover:text-violet-300"
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" /> {t("restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
