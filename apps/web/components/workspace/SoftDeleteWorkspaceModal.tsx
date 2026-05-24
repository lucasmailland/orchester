// apps/web/components/workspace/SoftDeleteWorkspaceModal.tsx
//
// Type-the-slug-to-confirm modal that drives the soft-delete flow from
// Settings → Danger Zone. Differs from the legacy hard-delete in that
// the response contains a one-shot `restoreToken` + the 30-day deadline
// — we show both so the operator can copy the token before it's lost.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface Props {
  open: boolean;
  onClose: () => void;
  workspace: { name: string; slug: string };
}

interface SoftDeleteOk {
  restoreToken: string;
  restoreUntil: string;
}

export function SoftDeleteWorkspaceModal({ open, onClose, workspace }: Props) {
  const router = useRouter();
  const t = useTranslations("workspace.delete");
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SoftDeleteOk | null>(null);

  if (!open) return null;

  async function submit() {
    // Trim before compare so paste-with-trailing-whitespace doesn't
    // silently fail the guard (B4.2).
    if (confirm.trim() !== workspace.slug) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workspaces/${workspace.slug}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm_slug: workspace.slug, reason: reason || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error ?? "Delete failed");
        setBusy(false);
        return;
      }
      setResult({ restoreToken: j.restoreToken, restoreUntil: j.restoreUntil });
    } catch {
      toast.error("Network error");
      setBusy(false);
    }
  }

  function copyToken() {
    if (!result) return;
    navigator.clipboard.writeText(result.restoreToken);
    toast.success("Restore token copied");
  }

  function finish() {
    onClose();
    // After successful delete, bounce out of the dead workspace.
    router.push("/");
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="soft-delete-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy && !result) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-surface p-5 shadow-2xl">
        {!result ? (
          <>
            <h3
              id="soft-delete-title"
              className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400"
            >
              <AlertTriangle size={14} />
              {t("title", { name: workspace.name })}
            </h3>
            <p className="mt-2 text-xs text-muted">{t("intro")}</p>
            <ul className="ml-4 mt-1 list-disc text-xs text-muted">
              <li>{t("willHide")}</li>
              <li>{t("willPause")}</li>
            </ul>
            <p className="mt-3 text-xs text-muted">{t("confirmLabel")}</p>
            <code className="mt-2 block rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-sm text-strong">
              {workspace.slug}
            </code>
            <label htmlFor="soft-delete-confirm" className="sr-only">
              slug
            </label>
            <input
              id="soft-delete-confirm"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={workspace.slug}
              className="input mt-3 font-mono"
              autoFocus
            />
            <label
              htmlFor="soft-delete-reason"
              className="mt-3 block text-[11px] uppercase tracking-wide text-muted"
            >
              {t("reasonLabel")}
            </label>
            <textarea
              id="soft-delete-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="input mt-1 resize-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={confirm.trim() !== workspace.slug || busy}
                className="btn-danger"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 size={14} />}
                {t("submit")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
              {t("deleted", { days: 30 })}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {new Date(result.restoreUntil).toLocaleString()}
            </p>
            <p className="mt-3 text-[11px] uppercase tracking-wide text-muted">Restore token</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-strong">
                {result.restoreToken}
              </code>
              <button
                type="button"
                onClick={copyToken}
                aria-label="Copy restore token"
                className="btn-secondary"
              >
                <Copy size={14} />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Save this token — it&apos;s the only way to restore without the original owner.
            </p>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={finish} className="btn-primary">
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
