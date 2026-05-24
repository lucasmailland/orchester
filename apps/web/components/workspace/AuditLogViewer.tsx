// apps/web/components/workspace/AuditLogViewer.tsx
//
// Phase E read-side of the tamper-evident audit log. Replaces the
// legacy `apps/web/components/settings/AuditLogSection.tsx` for
// workspaces that adopted the slug-keyed Phase E API.
//
// Features:
//   - Cursor pagination via `/api/workspaces/[slug]/audit?cursor=…`
//   - Chain status badge (intact / broken) backed by the
//     `/audit/verify` endpoint.
//
// Calls the verify endpoint on mount and on explicit "Re-verify" click.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

interface AuditEntry {
  id: string;
  seq: string;
  action: string;
  actorUserId: string | null;
  actorKind: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface VerifyResult {
  workspaceId: string;
  entriesChecked: number;
  brokenAt: { entryId: string; expectedHash: string; foundHash: string } | null;
  verifiedAt: string;
}

interface Props {
  workspaceSlug: string;
}

export function AuditLogViewer({ workspaceSlug }: Props) {
  const t = useTranslations("workspace.audit");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chain, setChain] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const loadPage = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      const url = new URL(
        `/api/workspaces/${workspaceSlug}/audit`,
        typeof window !== "undefined" ? window.location.origin : "http://localhost"
      );
      url.searchParams.set("limit", "50");
      if (cursor) url.searchParams.set("cursor", cursor);
      try {
        const r = await fetch(url.toString());
        if (!r.ok) {
          setLoading(false);
          return;
        }
        const j = await r.json();
        setEntries((prev) => (cursor ? [...prev, ...j.entries] : j.entries));
        setNextCursor(j.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [workspaceSlug]
  );

  const verifyNow = useCallback(async () => {
    setVerifying(true);
    try {
      const r = await fetch(`/api/workspaces/${workspaceSlug}/audit/verify`);
      if (r.ok) setChain(await r.json());
    } finally {
      setVerifying(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    void loadPage(null);
    void verifyNow();
  }, [loadPage, verifyNow]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-strong">{t("title")}</h2>
          <p className="text-xs text-muted">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={verifyNow}
          disabled={verifying}
          className="btn-secondary"
          aria-label={t("verifyAria")}
        >
          {verifying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("reverify")}
        </button>
      </div>

      {chain ? (
        <div
          className={
            chain.brokenAt
              ? "flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
              : "flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
          }
        >
          {chain.brokenAt ? (
            <ShieldAlert className="h-3.5 w-3.5" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          <span className="font-medium">
            {t("chainStatus")}: {chain.brokenAt ? t("chainBroken") : t("chainIntact")}
          </span>
          <span className="opacity-75">
            ({chain.entriesChecked} {t("entries")})
          </span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-line">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">seq</th>
              <th className="px-3 py-2">{t("action")}</th>
              <th className="px-3 py-2">{t("actor")}</th>
              <th className="px-3 py-2">{t("target")}</th>
              <th className="px-3 py-2">{t("when")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-[11px] text-muted">{e.seq}</td>
                <td className="px-3 py-2 font-mono">{e.action}</td>
                <td className="px-3 py-2 text-muted">
                  {e.actorUserId ? e.actorUserId.slice(-6) : e.actorKind}
                </td>
                <td className="px-3 py-2 text-muted">
                  {e.targetType}/{e.targetId.slice(-6)}
                </td>
                <td className="px-3 py-2 text-muted">{new Date(e.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadPage(nextCursor)}
            disabled={loading}
            className="btn-secondary"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
