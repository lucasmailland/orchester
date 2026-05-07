"use client";

import { useEffect, useState } from "react";
import { Loader2, Monitor, Smartphone, Laptop, Trash2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

/**
 * Lista de sesiones activas del user. Permite:
 *  - revocar una sesión específica (logout remoto)
 *  - revocar TODAS las otras sesiones (botón rojo "cerrar todas las demás")
 * No permite revocar la sesión actual desde acá — para eso está el logout.
 */
export function SessionsSection() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const r = await fetch("/api/sessions");
    if (!r.ok) return;
    const j = await r.json();
    setSessions(j.sessions);
  }

  async function revoke(id: string) {
    setBusyId(id);
    const r = await fetch(`/api/sessions?id=${id}`, { method: "DELETE" });
    setBusyId(null);
    if (r.ok) {
      toast.success("Sesión revocada");
      void load();
    } else {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "No se pudo revocar");
    }
  }

  async function revokeAll() {
    if (!confirm("¿Cerrar todas las otras sesiones? Tu sesión actual queda activa.")) return;
    setBusyAll(true);
    const r = await fetch("/api/sessions?all=true", { method: "DELETE" });
    setBusyAll(false);
    if (r.ok) {
      const j = await r.json();
      toast.success(`${j.revoked} sesiones cerradas`);
      void load();
    } else {
      toast.error("No se pudo revocar");
    }
  }

  function deviceIcon(ua: string | null): React.ReactNode {
    if (!ua) return <Monitor className="h-4 w-4" />;
    if (/iPhone|Android.*Mobile/i.test(ua)) return <Smartphone className="h-4 w-4" />;
    if (/Macintosh|Windows|Linux/i.test(ua)) return <Laptop className="h-4 w-4" />;
    return <Monitor className="h-4 w-4" />;
  }

  function deviceLabel(ua: string | null): string {
    if (!ua) return "Desconocido";
    const m =
      ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/) ??
      ua.match(/(Macintosh|Windows|Linux|iPhone|Android)/);
    return m ? m[0] : "Desconocido";
  }

  return (
    <div className="space-y-4">
      {sessions === null ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-zinc-500">Sin sesiones activas.</p>
      ) : (
        <ul className="space-y-2">
          {sessions
            .sort((a, b) => (a.isCurrent ? -1 : b.isCurrent ? 1 : 0))
            .map((s) => (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-zinc-900/40 px-3 py-2.5 text-xs",
                  s.isCurrent ? "border-emerald-500/30" : "border-white/[0.06]"
                )}
              >
                <div className="text-zinc-400">{deviceIcon(s.userAgent)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-100">{deviceLabel(s.userAgent)}</span>
                    {s.isCurrent && (
                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
                        actual
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {s.ipAddress ?? "IP desconocida"} · creada{" "}
                    {new Date(s.createdAt).toLocaleString()} · expira{" "}
                    {new Date(s.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => void revoke(s.id)}
                    disabled={busyId === s.id}
                    aria-label="Cerrar esta sesión"
                    className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
                  >
                    {busyId === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}

      {sessions && sessions.length > 1 && (
        <div className="border-t border-white/[0.06] pt-3">
          <button
            type="button"
            onClick={() => void revokeAll()}
            disabled={busyAll}
            className="btn-danger"
          >
            {busyAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
            Cerrar todas las otras sesiones
          </button>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Útil si sospechás que alguien tiene acceso a tu cuenta. Tu sesión actual no se cierra.
          </p>
        </div>
      )}
    </div>
  );
}
