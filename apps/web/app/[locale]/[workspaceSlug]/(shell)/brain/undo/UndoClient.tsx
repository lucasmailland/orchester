"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Undo2, Bot, User, AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@heroui/react";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { forgetFact, restoreFact, pinFact, unpinFact } from "@/lib/hooks/use-brain-facts";

type ChangeAction = "created" | "updated" | "forgotten" | "restored" | "pinned" | "unpinned";

interface ChangeEntry {
  id: string;
  factId: string;
  factStatement: string;
  factSubject: string;
  factKind: string;
  action: ChangeAction;
  actorKind: "user" | "system";
  actorName: string | null;
  timestamp: string;
  revertible: boolean;
  /** When known, the previous statement (used to roll back PATCHes). */
  previousStatement?: string;
}

interface UndoResponse {
  items: ChangeEntry[];
  /** Total number of changes available — may exceed `items.length`. */
  total: number;
  /** If false, the endpoint isn't implemented yet (D1 contract). */
  available: boolean;
}

const SEVEN_DAYS_MS = 7 * 86_400_000;
const MAX_ROWS = 20;

const EMPTY_RESPONSE: UndoResponse = { items: [], total: 0, available: false };

async function fetchUndoLog(url: string): Promise<UndoResponse> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    return EMPTY_RESPONSE;
  }
  if (res.status === 404) return EMPTY_RESPONSE;
  if (!res.ok) throw new Error(`undo log fetch failed (${res.status})`);
  try {
    const body = (await res.json()) as Partial<UndoResponse>;
    return {
      items: Array.isArray(body.items) ? body.items : [],
      total: typeof body.total === "number" ? body.total : (body.items?.length ?? 0),
      available: true,
    };
  } catch {
    return EMPTY_RESPONSE;
  }
}

const ACTION_TONES: Record<ChangeAction, string> = {
  created: "bg-emerald-500/15 text-emerald-300",
  updated: "bg-amber-500/15 text-amber-300",
  forgotten: "bg-red-500/15 text-red-300",
  restored: "bg-emerald-500/15 text-emerald-300",
  pinned: "bg-violet-500/15 text-violet-300",
  unpinned: "bg-slate-500/15 text-slate-300",
};

export function UndoClient() {
  const t = useTranslations("brain.undo");
  const locale = useLocale();
  const params = useParams<{ workspaceSlug: string; locale: string }>();
  const slug = params?.workspaceSlug;
  const localeForLink = params?.locale ?? locale;
  const [reverting, setReverting] = useState<string | null>(null);

  const { data, error, isLoading, isValidating, mutate } = useSWR<UndoResponse>(
    `/api/mnemo/audit?limit=${MAX_ROWS}`,
    fetchUndoLog,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      dedupingInterval: 5_000,
    }
  );

  const available = data?.available ?? false;

  // Annotate revertibility client-side based on the 7-day rule. The server
  // may also flag this — we honor both signals.
  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const now = Date.now();
    return items.map((entry) => {
      const ts = new Date(entry.timestamp).getTime();
      const withinWindow = now - ts <= SEVEN_DAYS_MS;
      const canRevert = entry.revertible !== false && withinWindow;
      return { ...entry, canRevert, withinWindow };
    });
  }, [data]);

  async function revertEntry(entry: ChangeEntry) {
    if (reverting) return;
    setReverting(entry.id);
    try {
      // Inverse mapping. PATCH-revert (statement rollback) is not wired here
      // because it depends on `previousStatement` being present AND D1
      // shipping a payload endpoint for it. Gracefully no-op with a toast.
      switch (entry.action) {
        case "forgotten":
          await restoreFact(entry.factId);
          break;
        case "restored":
          await forgetFact(entry.factId);
          break;
        case "pinned":
          await unpinFact(entry.factId);
          break;
        case "unpinned":
          await pinFact(entry.factId);
          break;
        case "created":
          await forgetFact(entry.factId);
          break;
        case "updated":
          notify.error(t("revertUnsupported"));
          return;
        default:
          notify.error(t("revertUnsupported"));
          return;
      }
      notify.success(t("revertSuccess"));
      void mutate();
    } catch {
      notify.error(t("revertError"));
    } finally {
      setReverting(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-fichap-primary" aria-hidden />
            <h1 className="text-xl font-bold text-strong">{t("title")}</h1>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted">{t("subtitle")}</p>
        </div>
        <Button
          size="sm"
          variant="flat"
          onPress={() => mutate()}
          isLoading={isValidating}
          startContent={!isValidating ? <RefreshCw className="h-3.5 w-3.5" /> : null}
        >
          {t("refresh")}
        </Button>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100/90">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
        <p>{t("windowNote")}</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-line bg-card"
              aria-hidden
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          {t("error")}
        </div>
      ) : null}

      {!isLoading && !error && !available ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
          <Undo2 className="mx-auto mb-3 h-8 w-8 text-faint" aria-hidden />
          <p className="text-sm font-semibold text-strong">{t("comingSoonTitle")}</p>
          <p className="mt-1 text-xs text-muted">{t("comingSoonBody")}</p>
        </div>
      ) : null}

      {!isLoading && !error && available && rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
          <p className="text-sm text-muted">{t("empty")}</p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ol className="space-y-2">
          {rows.map((row) => {
            const ts = new Date(row.timestamp);
            const when = new Intl.DateTimeFormat(locale, {
              year: "numeric",
              month: "short",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }).format(ts);
            const ActorIcon = row.actorKind === "system" ? Bot : User;
            const actorName =
              row.actorKind === "system" ? t("actorSystem") : (row.actorName ?? t("actorUser"));
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-card p-3"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-elevated">
                  <ActorIcon className="h-3.5 w-3.5 text-muted" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-faint">
                    <span className={cn("rounded px-2 py-0.5", ACTION_TONES[row.action])}>
                      {t(`actions.${row.action}`)}
                    </span>
                    <span>·</span>
                    <span>{actorName}</span>
                    <span>·</span>
                    <span className="font-mono">{when}</span>
                  </div>
                  <Link
                    href={`/${localeForLink}/${slug}/brain/${row.factId}`}
                    className="mt-1 block text-sm text-strong hover:text-fichap-primary"
                  >
                    <span className="line-clamp-2">{row.factStatement}</span>
                  </Link>
                </div>
                <Button
                  size="sm"
                  variant="flat"
                  color={row.canRevert ? "primary" : "default"}
                  isDisabled={!row.canRevert || reverting === row.id}
                  isLoading={reverting === row.id}
                  onPress={() => revertEntry(row)}
                  title={!row.canRevert ? t("revertDisabled") : t("revertButton")}
                >
                  {t("revertButton")}
                </Button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
