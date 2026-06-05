"use client";

// Review queue client — surfaces low-confidence + contradiction items
// the workers enqueue into `mnemo_review_queue` (migration 0032) so a
// human can resolve them. Mirrors the visual language of the rest of
// the /brain/* surfaces (Diff, Export, Undo).
//
// Resolution actions cascade per `/api/mnemo/review/[id]/resolve`:
//   kept      → close, fact stays active
//   edited    → close (assumes the operator PATCH'd separately)
//   forgotten → close + cascade `mnemo_fact.status = 'forgotten'`
//   dismissed → close, no cascade
import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Chip, Skeleton } from "@heroui/react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Inbox,
  Pencil,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface ReviewItem {
  id: string;
  workspaceId: string;
  factId: string;
  reason: "low_confidence" | "contradiction" | "manual";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: "kept" | "edited" | "forgotten" | "dismissed" | null;
}

interface ReviewList {
  items: ReviewItem[];
}

const REASON_TONE: Record<ReviewItem["reason"], string> = {
  low_confidence: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  contradiction: "bg-red-500/15 text-red-600 dark:text-red-300",
  manual: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
};

type Filter = "open" | "all";

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.round(hour / 24);
  if (day < 7) return `${day}d`;
  const week = Math.round(day / 7);
  if (week < 4) return `${week}w`;
  const month = Math.round(day / 30);
  return `${month}mo`;
}

export function ReviewClient() {
  const t = useTranslations("brain");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";

  const [filter, setFilter] = useState<Filter>("open");
  const url = filter === "all" ? "/api/mnemo/review?all=true" : "/api/mnemo/review";
  const { data, error, isLoading, mutate } = useSWR<ReviewList>(url, jsonFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5_000,
    shouldRetryOnError: false,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const openCount = items.filter((r) => !r.resolvedAt).length;

  async function resolve(item: ReviewItem, resolution: ReviewItem["resolution"]) {
    if (!resolution) return;
    try {
      const res = await fetch(`/api/mnemo/review/${encodeURIComponent(item.id)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) throw new Error(`resolve failed (${res.status})`);
      notify.success(t("review.toastResolved"));
      void mutate();
    } catch {
      notify.error(t("review.toastResolveError"));
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button
              as={Link}
              href={`/${locale}/${ws}/brain`}
              variant="light"
              size="sm"
              startContent={<ArrowLeft className="h-3.5 w-3.5" />}
            >
              {t("detail.back")}
            </Button>
            <h1 className="font-display text-2xl font-bold tracking-tight text-strong">
              {t("review.title")}
            </h1>
            {openCount > 0 ? (
              <Chip
                size="sm"
                variant="flat"
                className="bg-violet-500/15 text-[10px] text-violet-500"
              >
                {openCount}
              </Chip>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("review.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-elevated p-0.5">
            <button
              type="button"
              onClick={() => setFilter("open")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                filter === "open" ? "bg-card text-strong shadow-sm" : "text-muted"
              )}
            >
              {t("review.filterOpen")}
            </button>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                filter === "all" ? "bg-card text-strong shadow-sm" : "text-muted"
              )}
            >
              {t("review.filterAll")}
            </button>
          </div>
          <Button
            size="sm"
            variant="flat"
            onPress={() => mutate()}
            isLoading={isLoading}
            startContent={!isLoading ? <RefreshCw className="h-3.5 w-3.5" /> : null}
          >
            {t("actions.refreshNow")}
          </Button>
        </div>
      </header>

      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-card p-12 text-center">
          <AlertCircle className="h-6 w-6 text-danger" />
          <p className="text-sm text-muted">{t("errors.loadFailed")}</p>
          <Button size="sm" variant="flat" onPress={() => mutate()}>
            {t("errors.retry")}
          </Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line bg-card py-16 text-center">
          <div className="rounded-full bg-violet-500/10 p-4">
            <Inbox className="h-8 w-8 text-violet-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-strong">{t("review.emptyTitle")}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              {t("review.emptyDescription")}
            </p>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const isResolved = !!item.resolvedAt;
            return (
              <li
                key={item.id}
                className={cn(
                  "rounded-xl border border-line bg-card p-4 transition-colors",
                  isResolved && "opacity-60"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip
                        size="sm"
                        variant="flat"
                        className={cn(
                          "h-5 text-[10px] uppercase tracking-wider",
                          REASON_TONE[item.reason]
                        )}
                      >
                        {t(`review.reason_${item.reason}`)}
                      </Chip>
                      {isResolved ? (
                        <Chip
                          size="sm"
                          variant="flat"
                          className="h-5 bg-emerald-500/15 text-[10px] uppercase text-emerald-500"
                        >
                          {item.resolution
                            ? t(`review.resolution_${item.resolution}`)
                            : t("review.resolution_kept")}
                        </Chip>
                      ) : null}
                      <span className="text-[11px] text-faint">
                        {t("review.queuedAgo", { when: relativeTime(item.createdAt) })}
                      </span>
                    </div>
                    <Link
                      href={`/${locale}/${ws}/brain/${item.factId}`}
                      className="block font-mono text-xs text-body hover:text-violet-500"
                    >
                      {item.factId}
                    </Link>
                  </div>
                  {!isResolved ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        color="success"
                        startContent={<CheckCircle2 className="h-3.5 w-3.5" />}
                        onPress={() => resolve(item, "kept")}
                      >
                        {t("review.actionKeep")}
                      </Button>
                      <Button
                        as={Link}
                        href={`/${locale}/${ws}/brain/${item.factId}`}
                        size="sm"
                        variant="flat"
                        startContent={<Pencil className="h-3.5 w-3.5" />}
                      >
                        {t("review.actionEdit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        color="danger"
                        startContent={<Trash2 className="h-3.5 w-3.5" />}
                        onPress={() => resolve(item, "forgotten")}
                      >
                        {t("review.actionForget")}
                      </Button>
                      <Button
                        size="sm"
                        variant="light"
                        startContent={<XCircle className="h-3.5 w-3.5" />}
                        onPress={() => resolve(item, "dismissed")}
                      >
                        {t("review.actionDismiss")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
