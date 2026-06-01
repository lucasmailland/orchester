"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Download,
  BookOpen,
  BrainCircuit,
  AlertCircle,
  History,
  Zap,
  Clock,
  Undo2,
  GitCompare,
} from "lucide-react";
import { Button, Skeleton, Chip } from "@heroui/react";
import { notify } from "@/lib/toast";
import {
  type Fact,
  type FactsFilters,
  forgetFact,
  pinFact,
  restoreFact,
  unpinFact,
  useBrainFacts,
} from "@/lib/hooks/use-brain-facts";
import { useBrainHealthLatest } from "@/lib/hooks/use-brain-health";
import { useBrainReviewCount } from "@/lib/hooks/use-brain-review-count";
import { FactFilters } from "@/components/brain/FactFilters";
import { FactRow } from "@/components/brain/FactRow";
import { EditFactDialog } from "@/components/brain/EditFactDialog";
import { HealthDashboard } from "@/components/brain/HealthDashboard";
import { TimeTravelPicker } from "@/components/brain/TimeTravelPicker";

const DEFAULT_FILTERS: FactsFilters = {
  status: "active",
  sortBy: "updated",
  order: "desc",
  limit: 25,
};

export function BrainInspectorClient() {
  const t = useTranslations("brain");
  const router = useRouter();
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const searchParams = useSearchParams();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";

  // v1.6 G1-3: bitemporal "view memory as of …" state. Source of truth
  // is the URL query param `?asOf=ISO` so the historical view is
  // shareable. `null` = view current memory.
  const asOfFromUrl = useMemo<Date | null>(() => {
    const raw = searchParams?.get("asOf");
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [searchParams]);
  const [asOf, setAsOf] = useState<Date | null>(asOfFromUrl);

  // Reflect external URL changes (e.g. back/forward) into local state.
  useEffect(() => {
    setAsOf(asOfFromUrl);
  }, [asOfFromUrl]);

  const onAsOfChange = useCallback(
    (next: Date | null) => {
      setAsOf(next);
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      if (next) sp.set("asOf", next.toISOString());
      else sp.delete("asOf");
      // shallow URL update — Next 15 App Router treats router.replace as
      // a soft nav; we just want the URL to reflect the chosen instant.
      const qs = sp.toString();
      router.replace(`/${locale}/${ws}/brain${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, locale, ws]
  );

  const [filters, setFilters] = useState<FactsFilters>(DEFAULT_FILTERS);
  const filtersWithAsOf = useMemo<FactsFilters>(() => ({ ...filters, asOf }), [filters, asOf]);
  const [editing, setEditing] = useState<Fact | null>(null);
  const { items, total, error, isLoading, hasMore, loadingMore, loadMore, mutate } =
    useBrainFacts(filtersWithAsOf);
  const { snapshot, isLoading: healthLoading } = useBrainHealthLatest();
  const { count: reviewQueueCount } = useBrainReviewCount();

  const kpis = useMemo(() => {
    const totalFacts = snapshot?.factCountTotal ?? snapshot?.factCountActive ?? 0;
    const embeddedPct =
      snapshot?.factCountTotal && snapshot.factCountTotal > 0
        ? Math.round(((snapshot.factCountEmbedded ?? 0) / snapshot.factCountTotal) * 100)
        : null;
    return [
      { label: t("stats.totalFacts"), value: totalFacts, valueRaw: totalFacts },
      {
        label: t("stats.pinned"),
        value: snapshot?.factCountPinned ?? 0,
        valueRaw: snapshot?.factCountPinned ?? 0,
      },
      {
        label: t("stats.embedded"),
        value: embeddedPct !== null ? `${embeddedPct}%` : t("stats.noData"),
        valueRaw: embeddedPct,
      },
      {
        label: t("stats.active"),
        value: snapshot?.factCountActive ?? 0,
        valueRaw: snapshot?.factCountActive ?? 0,
      },
      {
        label: t("stats.forgotten"),
        value: snapshot?.factCountForgotten ?? 0,
        valueRaw: snapshot?.factCountForgotten ?? 0,
      },
    ];
  }, [snapshot, t]);

  // v1.6 G1-3: in time-travel mode edits are disabled — the user is
  // viewing a historical snapshot and we don't want to mutate the
  // current state of the world by accident. Each handler bails early
  // with a toast.
  const isTimeTravel = asOf !== null;

  async function handlePinToggle(fact: Fact) {
    if (isTimeTravel) {
      notify.error(t("timeTravel.editsDisabled"));
      return;
    }
    try {
      if (fact.pinned) await unpinFact(fact.id);
      else await pinFact(fact.id);
      notify.success(fact.pinned ? t("toast.unpinned") : t("toast.pinned"));
      void mutate();
    } catch {
      notify.error(t("toast.pinError"));
    }
  }

  async function handleForget(fact: Fact) {
    if (isTimeTravel) {
      notify.error(t("timeTravel.editsDisabled"));
      return;
    }
    try {
      await forgetFact(fact.id);
      notify.success(t("toast.forgotten"));
      void mutate();
    } catch {
      notify.error(t("toast.forgetError"));
    }
  }

  async function handleRestore(fact: Fact) {
    if (isTimeTravel) {
      notify.error(t("timeTravel.editsDisabled"));
      return;
    }
    try {
      await restoreFact(fact.id);
      notify.success(t("toast.restored"));
      void mutate();
    } catch {
      notify.error(t("toast.restoreError"));
    }
  }

  function handleViewCitations(fact: Fact) {
    router.push(`/${locale}/${ws}/brain/${fact.id}#citations`);
  }

  function handleEdit(fact: Fact) {
    if (isTimeTravel) {
      notify.error(t("timeTravel.editsDisabled"));
      return;
    }
    setEditing(fact);
  }

  function handleEdited(next: Fact) {
    void mutate();
    setEditing((current) => (current?.id === next.id ? next : current));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-violet-500" />
            <h1 className="font-display text-2xl font-bold tracking-tight text-strong">
              {t("title")}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* v1.6 G1-3: bitemporal time-travel — Inspector renders the
              memory snapshot at the chosen instant. */}
          <TimeTravelPicker value={asOf} onChange={onAsOfChange} />
          {/* Inspector UI v2 — recall pipeline visualizer entry point.
              Lands at /brain/recall-debug which captures and renders
              per-stage events from /api/mnemo/recall-debug. */}
          {/* v2 — Timeline / Undo / Diff were shipped pages but never
              surfaced from the toolbar. Discoverable now. */}
          <Button
            as={Link}
            href={`/${locale}/${ws}/brain/timeline`}
            variant="flat"
            size="sm"
            startContent={<Clock className="h-3.5 w-3.5" />}
            className="bg-elevated text-body"
          >
            Timeline
          </Button>
          <Button
            as={Link}
            href={`/${locale}/${ws}/brain/undo`}
            variant="flat"
            size="sm"
            startContent={<Undo2 className="h-3.5 w-3.5" />}
            className="bg-elevated text-body"
          >
            Undo
          </Button>
          <Button
            as={Link}
            href={`/${locale}/${ws}/brain/diff`}
            variant="flat"
            size="sm"
            startContent={<GitCompare className="h-3.5 w-3.5" />}
            className="bg-elevated text-body"
          >
            Diff
          </Button>
          <Button
            as={Link}
            href={`/${locale}/${ws}/brain/recall-debug`}
            variant="flat"
            size="sm"
            startContent={<Zap className="h-3.5 w-3.5" />}
            className="bg-elevated text-body"
          >
            Debug recall
          </Button>
          <Button
            as={Link}
            href={`/${locale}/${ws}/brain/review`}
            variant="flat"
            size="sm"
            startContent={<BookOpen className="h-3.5 w-3.5" />}
            className="bg-elevated text-body"
            aria-label={t("actions.reviewCount", { count: reviewQueueCount })}
          >
            {t("actions.reviewQueue")}
            {reviewQueueCount > 0 ? (
              <Chip
                size="sm"
                variant="flat"
                className="ml-1 h-5 bg-violet-500/15 text-[10px] text-violet-500"
              >
                {reviewQueueCount}
              </Chip>
            ) : null}
          </Button>
          <Button
            as={Link}
            href={`/${locale}/${ws}/brain/export`}
            color="primary"
            size="sm"
            startContent={<Download className="h-3.5 w-3.5" />}
          >
            {t("actions.export")}
          </Button>
        </div>
      </header>

      {/* v1.6 G1-3: time-travel banner — surfaces above the KPI strip
          so it's the FIRST thing the operator sees when in a
          historical view. */}
      {isTimeTravel ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
          <History className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <span>
            {t("timeTravel.banner", {
              date: asOf!.toLocaleDateString(locale, { dateStyle: "long" }),
            })}
          </span>
        </div>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-card p-4">
            <span className="text-[10px] uppercase tracking-wider text-faint">{k.label}</span>
            <div className="mt-2 text-2xl font-bold text-strong">
              {healthLoading ? (
                <Skeleton className="h-7 w-12 rounded-md" />
              ) : typeof k.value === "number" ? (
                k.value.toLocaleString()
              ) : (
                k.value
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Health charts */}
      <HealthDashboard />

      {/* Filters */}
      <FactFilters value={filters} onChange={setFilters} />

      {/* List */}
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
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {total > 0 ? (
            <div className="flex items-center justify-between text-[11px] text-faint">
              <span>{t("list.showing", { count: items.length, total })}</span>
            </div>
          ) : null}
          <ul className="space-y-2">
            {items.map((fact) => (
              <li key={fact.id}>
                <FactRow
                  fact={fact}
                  onPinToggle={handlePinToggle}
                  onForget={handleForget}
                  onRestore={handleRestore}
                  onViewCitations={handleViewCitations}
                  onEdit={handleEdit}
                />
              </li>
            ))}
          </ul>
          {hasMore ? (
            <div className="flex justify-center pt-2">
              <Button variant="flat" size="sm" onPress={() => loadMore()} isLoading={loadingMore}>
                {t("list.loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <EditFactDialog
        fact={editing}
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        onSaved={handleEdited}
      />
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("brain");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line bg-card py-16 text-center">
      <div className="rounded-full bg-violet-500/10 p-4">
        <BrainCircuit className="h-8 w-8 text-violet-500" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-strong">{t("empty.title")}</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("empty.description")}</p>
      </div>
      <Button
        as={Link}
        href={`/${locale}/${ws}/settings/ai-providers`}
        color="primary"
        variant="flat"
        size="sm"
      >
        {t("empty.ctaLabel")}
      </Button>
    </div>
  );
}
