"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface Props {
  token: string;
  pause: {
    runId: string;
    flowId: string;
    message: string;
    /** ISO string: a Date cannot cross the server/client boundary. */
    pausedAt: string | null;
  };
}

type ApprovalDecision = "aprobado" | "rechazado";

/**
 * The two buttons on the other side of a `wait_human` pause.
 *
 * What is deliberate here:
 *
 *   - **Both decisions are equally easy to reach.** A page with one big
 *     Approve and a rejection buried in small print is a page that collects
 *     approvals, not decisions.
 *   - **The name is asked for, not required.** `quien` is optional in the API
 *     and defaults to "anónimo"; an approval without an author cannot be
 *     audited afterwards, so the field is there — but blocking on it would
 *     only teach people to type a dot.
 *   - **The outcome replaces the buttons.** The token is single-use: it is
 *     cleared in the same write that records the decision, so leaving the
 *     buttons live would invite a second click that can only fail.
 *   - **A failed request leaves the buttons enabled**, and says the link still
 *     works. The run is still paused — the write is guarded by
 *     `status = 'paused'` — so retrying is safe and is the right move.
 */
export function ApprovalClient({ token, pause }: Props) {
  const t = useTranslations("approvals");
  const [submitting, setSubmitting] = useState<ApprovalDecision | null>(null);
  const [resolved, setResolved] = useState<ApprovalDecision | null>(null);
  const [approver, setApprover] = useState("");

  async function submitDecision(decision: ApprovalDecision) {
    setSubmitting(decision);
    try {
      const r = await fetch(`/api/approvals/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          ...(approver.trim() ? { quien: approver.trim() } : {}),
        }),
      });
      if (r.ok) {
        setResolved(decision);
        toast.success(decision === "aprobado" ? t("approved") : t("rejected"));
        return;
      }
      // 404 covers both "never existed" and "already resolved" — the API
      // answers the same for either so a leaked link reveals nothing. From
      // here the useful thing to say is that it is no longer actionable.
      const j = await r.json().catch(() => ({}));
      toast.error(r.status === 404 ? (j.error ?? t("invalidTitle")) : t("failed"));
    } catch {
      toast.error(t("failed"));
    } finally {
      setSubmitting(null);
    }
  }

  if (resolved) {
    return (
      <div className="max-w-md rounded-2xl border border-violet-500/30 bg-zinc-900/50 p-6 text-center">
        <h1 className="text-lg font-semibold text-zinc-100">
          {resolved === "aprobado" ? t("approved") : t("rejected")}
        </h1>
        <p className="mt-1.5 font-mono text-xs text-zinc-500">
          {t("runLabel")} {pause.runId}
        </p>
      </div>
    );
  }

  const busy = submitting !== null;

  return (
    <div className="w-full max-w-md rounded-2xl border border-violet-500/30 bg-zinc-900/50 p-6">
      <h1 className="text-lg font-semibold text-zinc-100">{t("title")}</h1>

      {/* The flow author's own words. `whitespace-pre-line` because the
          message is written in a flow editor and its line breaks are meant. */}
      <p className="mt-3 whitespace-pre-line text-sm text-zinc-300">{pause.message}</p>

      <dl className="mt-4 space-y-1 text-xs text-zinc-500">
        <div className="flex gap-2">
          <dt>{t("flowLabel")}</dt>
          <dd className="font-mono text-zinc-400">{pause.flowId}</dd>
        </div>
        <div className="flex gap-2">
          <dt>{t("runLabel")}</dt>
          <dd className="font-mono text-zinc-400">{pause.runId}</dd>
        </div>
        {pause.pausedAt ? (
          <div className="flex gap-2">
            <dt>{t("pausedAt")}</dt>
            {/* The server renders UTC and the browser renders local time, which
                makes React complain about a hydration mismatch. `suppressHydrationWarning`
                is the documented escape for exactly this: a value that is
                *supposed* to differ between server and client. */}
            <dd className="text-zinc-400" suppressHydrationWarning>
              {new Date(pause.pausedAt).toLocaleString()}
            </dd>
          </div>
        ) : null}
      </dl>

      <label className="mt-5 block">
        <span className="text-xs text-zinc-400">{t("whoLabel")}</span>
        <input
          type="text"
          value={approver}
          onChange={(e) => setApprover(e.target.value)}
          placeholder={t("whoPlaceholder")}
          maxLength={200}
          disabled={busy}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none disabled:opacity-50"
        />
      </label>

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={() => submitDecision("aprobado")}
          disabled={busy}
          className="flex-1 rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
        >
          {submitting === "aprobado" ? t("deciding") : t("approve")}
        </button>
        <button
          type="button"
          onClick={() => submitDecision("rechazado")}
          disabled={busy}
          className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
        >
          {submitting === "rechazado" ? t("deciding") : t("reject")}
        </button>
      </div>

      <p className="mt-3 text-center text-xs text-zinc-600">{t("oneShot")}</p>
    </div>
  );
}
