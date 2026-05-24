// apps/web/components/workspace/FeatureFlagAdminPanel.tsx
//
// Settings → Feature flags. Admin/owner only — the server gates the
// `GET /feature-flags` + `PUT /feature-flags/[key]` endpoints.
//
// Optimistic toggle: flip the local state first, fire the PUT, roll
// back on failure. Avoids the "click → 500ms → flip" jank for a row of
// flags that won't change very often.
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface FlagRow {
  id: string;
  workspaceId: string;
  flagKey: string;
  enabled: boolean;
  setByUserId: string | null;
  rolledOutAt: string | null;
  updatedAt: string | null;
}

interface Props {
  workspaceSlug: string;
}

export function FeatureFlagAdminPanel({ workspaceSlug }: Props) {
  const t = useTranslations("workspace.featureFlags");
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/workspaces/${workspaceSlug}/feature-flags`);
      if (!r.ok) {
        if (!cancelled) setLoading(false);
        return;
      }
      const j = await r.json();
      if (!cancelled) {
        setFlags(j.flags);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  async function toggle(flag: FlagRow, next: boolean) {
    // Optimistic flip.
    setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, enabled: next } : f)));
    try {
      const r = await fetch(
        `/api/workspaces/${workspaceSlug}/feature-flags/${encodeURIComponent(flag.flagKey)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        }
      );
      if (!r.ok) throw new Error(`status_${r.status}`);
    } catch (e) {
      // Rollback.
      setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, enabled: !next } : f)));
      toast.error(`Could not update ${flag.flagKey}`);
    }
  }

  const filtered = query
    ? flags.filter((f) => f.flagKey.toLowerCase().includes(query.toLowerCase()))
    : flags;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-strong">{t("title")}</h2>
        <p className="text-xs text-muted">{t("subtitle")}</p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("search")}
        className="input"
      />

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
          No flags set yet.
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {filtered.map((flag) => (
            <li key={flag.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-strong">{flag.flagKey}</p>
                <p className="text-[11px] text-muted">
                  {t("setBy", {
                    actor: flag.setByUserId ? flag.setByUserId.slice(-6) : t("system"),
                    time: flag.updatedAt ? new Date(flag.updatedAt).toLocaleString() : "—",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void toggle(flag, !flag.enabled)}
                aria-pressed={flag.enabled}
                className={
                  flag.enabled
                    ? "h-6 w-11 rounded-full bg-emerald-500 px-1 transition-colors"
                    : "h-6 w-11 rounded-full bg-zinc-300 px-1 transition-colors dark:bg-zinc-700"
                }
              >
                <span
                  className={
                    flag.enabled
                      ? "block h-4 w-4 translate-x-5 rounded-full bg-white transition-transform"
                      : "block h-4 w-4 translate-x-0 rounded-full bg-white transition-transform"
                  }
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
