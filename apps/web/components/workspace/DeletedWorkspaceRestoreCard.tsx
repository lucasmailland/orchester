// apps/web/components/workspace/DeletedWorkspaceRestoreCard.tsx
//
// Client component rendered by `/[locale]/deleted/[id]` when a
// soft-deleted workspace is still within its 30-day restore window.
//
// Two authentication paths (mirrors the `/restore` route):
//   1. The authenticated caller is the original owner → token is
//      optional. Just press restore.
//   2. Any authenticated user with the one-shot `restoreToken` → the
//      server validates the token, marks it consumed, and restores.
//
// Display:
//   - Workspace name
//   - "Deleted on …" timestamp
//   - "Restore window closes in …" countdown
//   - Token input (pre-filled from `?token=…` if present)
//   - Submit → POST /api/workspaces/[slug]/restore
//
// On success, redirect into the workspace at `/[locale]/[slug]`.
//
// All visible failure paths funnel into a generic "restore failed"
// toast — the server intentionally collapses lifecycle and token
// errors to a single 403 so we never tell the user WHY their request
// was rejected. Audit log is the diagnostic surface.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, RotateCcw } from "lucide-react";
import { notify } from "@/lib/toast";

interface Props {
  workspace: {
    slug: string;
    name: string;
    deletedAt: string;
    restoreUntil: string;
  };
  initialToken: string;
  /**
   * Whether the caller is authenticated as the original workspace
   * owner. If true, the token field stays optional — the server
   * accepts ownership as proof. If false, the token is the only path
   * forward, but we still don't `required` it so we can show a more
   * helpful error than the browser's default.
   */
  isOwner: boolean;
}

/**
 * Compute days-and-hours remaining until `until`. Returns the strings
 * we render verbatim, e.g. "3d 4h" — keeps the JSX free of date math.
 * Using a fresh `Date()` each call is fine because the parent only
 * re-renders when its props change; we don't tick this on a timer.
 */
function formatRemaining(until: Date): { days: number; hours: number } {
  const ms = Math.max(0, until.getTime() - Date.now());
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  return { days, hours };
}

export function DeletedWorkspaceRestoreCard({ workspace, initialToken, isOwner }: Props) {
  const t = useTranslations("workspace.restore");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "en";

  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);

  // Re-derive every render — the parent provides ISO strings so the
  // dates only change if the page reloads. `useMemo` keeps the
  // `Date()` allocations off the hot path.
  const restoreUntilDate = useMemo(
    () => new Date(workspace.restoreUntil),
    [workspace.restoreUntil]
  );
  const deletedAtDate = useMemo(() => new Date(workspace.deletedAt), [workspace.deletedAt]);
  const remaining = useMemo(() => formatRemaining(restoreUntilDate), [restoreUntilDate]);

  // Tick the countdown every minute so an idle viewer sees the
  // remaining window decrement without having to reload.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (token.trim()) body.token = token.trim();
      const r = await fetch(`/api/workspaces/${workspace.slug}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        // The server collapses every authorization / lifecycle error
        // to a single 403 to keep the route non-enumerable. We
        // therefore surface a single generic failure message — the
        // audit log is the diagnostic surface, not this toast.
        notify.error(t("restoreFailed"));
        setBusy(false);
        return;
      }
      notify.success(t("restored"));
      router.push(`/${locale}/${workspace.slug}`);
    } catch {
      notify.error(t("restoreFailed"));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
    >
      <header className="mb-4">
        <h1 className="text-lg font-bold text-strong">{t("title", { name: workspace.name })}</h1>
        <p className="mt-1 text-xs text-muted">
          {t("deletedOn", { date: deletedAtDate.toLocaleString() })}
        </p>
        <p className="mt-1 text-xs text-muted">
          {t("restoreUntil", { date: restoreUntilDate.toLocaleString() })}
        </p>
        <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          {remaining.days}d {remaining.hours}h
        </p>
      </header>

      <div>
        <label
          htmlFor="restore-token"
          className="block text-[11px] uppercase tracking-wide text-muted"
        >
          {t("tokenLabel")}
        </label>
        <input
          id="restore-token"
          name="restore-token"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("tokenPlaceholder")}
          className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 font-mono text-xs text-strong outline-none"
        />
        <p className="mt-1 text-[10px] text-faint">{isOwner ? t("tokenHint") : t("tokenLabel")}</p>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={busy || (!isOwner && token.trim().length === 0)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {busy ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}
