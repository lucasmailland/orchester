// apps/web/components/workspace/GdprExportProgress.tsx
//
// Sticky bottom-right toast that surfaces a long-running GDPR export
// job's progress. Mounted in the workspace shell layout so it survives
// in-app navigation between pages.
//
// State lives in `localStorage` (key: `orch-gdpr-export-job`) so the
// toast survives full page reloads — the user triggers an export from
// Settings, the trigger UI calls `setExportJobId(...)` to persist the
// ID, and from then on every shell-mounted instance picks it up and
// polls the job endpoint every 3s until the job completes / fails.
//
// Cross-tab sync: the `storage` event lets a second tab pick up the
// job when the first tab writes it. Dismissing clears the key, and we
// also dispatch a synthetic StorageEvent so other components mounted
// in the SAME tab see the change immediately (the native event only
// fires in other tabs).
//
// We intentionally render nothing while `slug` or `jobId` are missing,
// or while the polled endpoint returns an error / 404 — the toast is
// meant to be invisible until a real job exists.
//
// Response shape matches `GET /api/workspaces/[slug]/export/[jobId]`
// (flat — job columns serialised at top level, not wrapped). State
// machine is the workspace export enum: pending → exporting →
// uploading → emailing → completed | failed.
"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Download, Loader2, X, AlertCircle } from "lucide-react";

const LS_KEY = "orch-gdpr-export-job";

type ExportState = "pending" | "exporting" | "uploading" | "emailing" | "completed" | "failed";

/**
 * Flat response shape from `GET /api/workspaces/[slug]/export/[jobId]`.
 * Mirrors `schema.gdprExportJobs.$inferSelect` minus the redacted
 * internal columns (`storageKey`, `checkpoint`).
 *
 * `progress` is an integer percentage (0-100) — NOT 0-1 — straight
 * out of the DB column. `bytesTotal` is serialised as a string by the
 * route to avoid the bigint→JSON throw; we don't display it but keep
 * the field so the type matches what the server actually returns.
 */
interface ExportJobResponse {
  id?: string;
  state?: ExportState;
  progress?: number;
  signedUrl?: string | null;
  signedUrlExpiresAt?: string | null;
  bytesTotal?: string | null;
  error?: string | null;
}

async function fetcher(url: string): Promise<ExportJobResponse | null> {
  const r = await fetch(url);
  // 404 → job vanished (retention swept it) or the slug→job pair
  // doesn't match. Return null so the component renders nothing —
  // there's no useful state to show the user about a job they can't
  // poll anymore.
  if (!r.ok) return null;
  return (await r.json()) as ExportJobResponse;
}

/**
 * Public helper: persist a freshly-minted job ID so the in-shell
 * component picks it up via the storage event. Call from the
 * export-trigger UI right after POST to `/export` succeeds.
 *
 * Writes are no-ops on the server (during SSR `localStorage` is
 * undefined). Passing `null` clears the key.
 */
export function setExportJobId(jobId: string | null): void {
  if (typeof window === "undefined") return;
  if (jobId === null) {
    window.localStorage.removeItem(LS_KEY);
  } else {
    window.localStorage.setItem(LS_KEY, jobId);
  }
  // The 'storage' event only fires in OTHER tabs. Dispatch a synthetic
  // event so the component in the SAME tab updates immediately too.
  window.dispatchEvent(new StorageEvent("storage", { key: LS_KEY, newValue: jobId }));
}

export function GdprExportProgress(): React.ReactElement | null {
  const t = useTranslations("workspace.export");
  const params = useParams<{ workspaceSlug?: string }>();
  const slug = params?.workspaceSlug;

  const [jobId, setJobId] = useState<string | null>(null);

  // Hydrate from localStorage on mount + subscribe to changes from
  // other tabs (and our own `setExportJobId` synthetic dispatch).
  useEffect(() => {
    setJobId(window.localStorage.getItem(LS_KEY));
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) setJobId(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Poll while we have a (slug, jobId) pair. SWR keys on the URL so
  // changing the jobId tears down + spins up a fresh cache entry.
  const { data, mutate } = useSWR<ExportJobResponse | null>(
    slug && jobId ? `/api/workspaces/${slug}/export/${jobId}` : null,
    fetcher,
    {
      refreshInterval: (latest) => {
        // Stop polling once the job hits a terminal state — we still
        // render the toast, but there's no reason to keep hitting the
        // endpoint every 3s.
        const state = latest?.state;
        if (state === "completed" || state === "failed") return 0;
        return 3000;
      },
      revalidateOnFocus: true,
    }
  );

  const dismiss = useCallback(() => {
    setExportJobId(null);
    setJobId(null);
    void mutate(undefined, { revalidate: false });
  }, [mutate]);

  if (!jobId || !data || !data.state) return null;
  const { state, progress, signedUrl, signedUrlExpiresAt, error } = data;

  // Treat the four "in-flight" states uniformly for the headline; the
  // server may emit `uploading` / `emailing` between `exporting` and
  // `completed`, both of which we collapse to the generic in-flight
  // copy so the user doesn't see jargon for transient steps.
  const isTerminal = state === "completed" || state === "failed";
  const headline =
    state === "pending"
      ? t("preparing")
      : state === "completed"
        ? t("ready")
        : state === "failed"
          ? t("failed")
          : t("exporting");

  // DB column is an int (0-100). Clamp defensively so a wildcard
  // value can't break the progress bar layout.
  const percent = Math.max(0, Math.min(100, Math.round(progress ?? 0)));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-labelledby="gdpr-export-headline"
      className="fixed bottom-4 right-4 z-40 w-[320px] rounded-2xl border border-line bg-surface p-4 shadow-2xl"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {state === "completed" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : state === "failed" ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" />
          )}
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted">{t("title")}</div>
            <div id="gdpr-export-headline" className="truncate text-xs font-medium text-strong">
              {headline}
            </div>
          </div>
        </div>
        {/* Only allow dismiss in terminal states — while polling the
            toast stays pinned so the user doesn't lose the job
            reference. Trigger UI can call `setExportJobId(null)` as
            an escape hatch if it needs one. */}
        {isTerminal && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("dismiss")}
            className="text-muted hover:text-strong"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!isTerminal && (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          aria-label={t("progressLabel")}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-violet-500 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {state === "completed" && signedUrl && (
        <a
          href={signedUrl}
          download
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
        >
          <Download className="h-3 w-3" />
          {t("download")}
        </a>
      )}

      {state === "completed" && signedUrlExpiresAt && (
        <p className="mt-2 text-[10px] text-faint">
          {t("availableUntil", { date: new Date(signedUrlExpiresAt).toLocaleString() })}
        </p>
      )}

      {state === "failed" && error && (
        <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
