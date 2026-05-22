"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsCard, Toggle } from "./_layout";

interface Pref {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  source: "user" | "workspace" | "default";
}

/**
 * Notifications: cada toggle es un PATCH al endpoint, optimistic UI con
 * rollback ante error. Los defaults vienen del server (no hardcoded acá)
 * para que el catálogo viva en un solo lugar.
 */
export function NotificationsSection() {
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const r = await fetch("/api/notification-prefs");
    if (!r.ok) return;
    const j = await r.json();
    setPrefs(j.prefs as Pref[]);
  }

  async function toggle(p: Pref, next: boolean) {
    if (!prefs) return;
    // Optimistic
    setPrefs(prefs.map((x) => (x.key === p.key ? { ...x, enabled: next, source: "user" } : x)));
    setBusyKey(p.key);
    const r = await fetch("/api/notification-prefs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: p.key, enabled: next }),
    });
    setBusyKey(null);
    if (!r.ok) {
      // Rollback
      setPrefs(prefs);
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "No se pudo guardar la preferencia");
    }
  }

  return (
    <SettingsCard
      icon={<Bell size={16} />}
      title="Notificaciones"
      description="Elegí qué eventos te disparan un mail. Tus preferencias son personales — no afectan al resto del workspace."
    >
      {prefs === null ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-3">
          {prefs.map((p) => (
            <div key={p.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-body">{p.label}</p>
                <p className="text-xs text-faint">{p.description}</p>
                {p.source !== "user" && (
                  <p className="mt-0.5 text-[10px] text-faint">
                    Default {p.source === "workspace" ? "del workspace" : "del sistema"} · cambialo
                    para fijar tu preferencia personal.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {busyKey === p.key && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted" />
                )}
                <Toggle
                  checked={p.enabled}
                  onChange={(next) => void toggle(p, next)}
                  label={p.label}
                  disabled={busyKey === p.key}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  );
}
