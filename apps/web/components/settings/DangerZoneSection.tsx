"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  workspace: { id: string; name: string; slug: string; role: string };
}

/**
 * Zona de peligro: borrar el workspace.
 * - Sólo el `owner` puede ejecutar (server enforcing).
 * - Modal con confirmación tipo "type the slug to confirm" → estilo GitHub.
 * - El backend valida el slug en la query string como segunda barrera.
 */
export function DangerZoneSection({ workspace }: Props) {
  const router = useRouter();
  const isOwner = workspace.role === "owner";
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (confirm !== workspace.slug) return;
    setBusy(true);
    const r = await fetch(
      `/api/workspaces/${workspace.id}?slug=${encodeURIComponent(workspace.slug)}`,
      { method: "DELETE" }
    );
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "No se pudo eliminar el workspace");
      return;
    }
    toast.success("Workspace eliminado");
    setOpen(false);
    router.push("/auth/login");
  }

  return (
    <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
      <header className="mb-4 flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
          <AlertTriangle size={16} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Zona de peligro</h2>
          <p className="text-xs text-muted">
            Acción irreversible. Borra el workspace, todos sus agentes, conversaciones,
            knowledge bases y miembros.
          </p>
        </div>
      </header>

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!isOwner}
        title={isOwner ? "" : "Solo el owner del workspace puede eliminarlo"}
        className="btn-danger"
      >
        <Trash2 size={14} />
        Eliminar workspace
      </button>
      {!isOwner && (
        <p className="mt-2 text-[11px] text-muted">
          Tu rol es <strong className="text-body">{workspace.role}</strong>. Pedile al owner
          que ejecute esta acción.
        </p>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-ws-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-surface p-5 shadow-2xl">
            <h3 id="delete-ws-title" className="text-sm font-semibold text-red-600 dark:text-red-400">
              ¿Eliminar el workspace &ldquo;{workspace.name}&rdquo;?
            </h3>
            <p className="mt-1 text-xs text-muted">
              Esta acción no se puede deshacer. Para confirmar, escribí el slug del workspace:
            </p>
            <code className="mt-2 block rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-sm text-strong">
              {workspace.slug}
            </code>
            <label htmlFor="delete-confirm" className="sr-only">
              Confirmá tipeando el slug
            </label>
            <input
              id="delete-confirm"
              name="delete-confirm"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Tipeá el slug acá…"
              className="input mt-3 font-mono"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={confirm !== workspace.slug || busy}
                className="btn-danger"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 size={14} />}
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
