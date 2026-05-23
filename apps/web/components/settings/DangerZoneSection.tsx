"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("pages.settings.danger");
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
      toast.error(j.error ?? t("deleteError"));
      return;
    }
    toast.success(t("deleted"));
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
          <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">{t("title")}</h2>
          <p className="text-xs text-muted">{t("description")}</p>
        </div>
      </header>

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!isOwner}
        title={isOwner ? "" : t("onlyOwner")}
        className="btn-danger"
      >
        <Trash2 size={14} />
        {t("deleteButton")}
      </button>
      {!isOwner && (
        <p className="mt-2 text-[11px] text-muted">
          {t.rich("yourRoleIs", {
            role: workspace.role,
            b: (chunks) => <strong className="text-body">{chunks}</strong>,
          })}
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
            <h3
              id="delete-ws-title"
              className="text-sm font-semibold text-red-600 dark:text-red-400"
            >
              {t("modalTitle", { name: workspace.name })}
            </h3>
            <p className="mt-1 text-xs text-muted">{t("modalDescription")}</p>
            <code className="mt-2 block rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-sm text-strong">
              {workspace.slug}
            </code>
            <label htmlFor="delete-confirm" className="sr-only">
              {t("slugAria")}
            </label>
            <input
              id="delete-confirm"
              name="delete-confirm"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t("slugPlaceholder")}
              className="input mt-3 font-mono"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={confirm !== workspace.slug || busy}
                className="btn-danger"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 size={14} />}
                {t("deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
