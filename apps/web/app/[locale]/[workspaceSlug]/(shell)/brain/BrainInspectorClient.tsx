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
  Wrench,
  ClipboardCheck,
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
import { PageHero } from "@/components/compass/PageHero";
import { EmptyState as CompassEmptyState } from "@/components/compass/EmptyState";
import { TermDef } from "@/components/compass/TermDef";
import { Callout } from "@/components/compass/Callout";
import { ConfirmAction } from "@/components/compass/ConfirmAction";
import { NextStep, NextStepGroup } from "@/components/compass/NextStep";

const DEFAULT_FILTERS: FactsFilters = {
  status: "active",
  sortBy: "updated",
  order: "desc",
  limit: 25,
};

export function BrainInspectorClient() {
  const t = useTranslations("brain");
  const tc = useTranslations("compass.brain");
  const tEmpty = useTranslations("compass.empty.brain");
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
  // ConfirmAction state for the destructive "forget" verb. The dialog
  // shows the user the exact statement, scope, and reversibility of the
  // action before they commit. No impact numbers are fabricated.
  const [forgetTarget, setForgetTarget] = useState<Fact | null>(null);
  const [forgetPending, setForgetPending] = useState(false);
  const { items, total, error, isLoading, hasMore, loadingMore, loadMore, mutate } =
    useBrainFacts(filtersWithAsOf);
  const { snapshot, isLoading: healthLoading } = useBrainHealthLatest();
  const { count: reviewQueueCount } = useBrainReviewCount();

  type Kpi = {
    key: "totalFacts" | "pinned" | "embedded" | "active" | "forgotten";
    label: string;
    value: string | number;
  };
  const kpis = useMemo<Kpi[]>(() => {
    const totalFacts = snapshot?.factCountTotal ?? snapshot?.factCountActive ?? 0;
    const embeddedPct =
      snapshot?.factCountTotal && snapshot.factCountTotal > 0
        ? Math.round(((snapshot.factCountEmbedded ?? 0) / snapshot.factCountTotal) * 100)
        : null;
    return [
      { key: "totalFacts", label: t("stats.totalFacts"), value: totalFacts },
      { key: "pinned", label: t("stats.pinned"), value: snapshot?.factCountPinned ?? 0 },
      {
        key: "embedded",
        label: t("stats.embedded"),
        value: embeddedPct !== null ? `${embeddedPct}%` : t("stats.noData"),
      },
      { key: "active", label: t("stats.active"), value: snapshot?.factCountActive ?? 0 },
      { key: "forgotten", label: t("stats.forgotten"), value: snapshot?.factCountForgotten ?? 0 },
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

  function handleForget(fact: Fact) {
    if (isTimeTravel) {
      notify.error(t("timeTravel.editsDisabled"));
      return;
    }
    // Don't call the API yet — surface the destructive action through
    // ConfirmAction so the user sees the impact preview first.
    setForgetTarget(fact);
  }

  async function confirmForget() {
    if (!forgetTarget) return;
    setForgetPending(true);
    try {
      await forgetFact(forgetTarget.id);
      notify.success(t("toast.forgotten"));
      void mutate();
      setForgetTarget(null);
    } catch {
      notify.error(t("toast.forgetError"));
    } finally {
      setForgetPending(false);
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

  // Truncate a fact statement so the ConfirmAction impact row stays
  // readable. We never fabricate copy — empty stays empty (handled by
  // upstream validation), we just clip very long statements.
  function previewStatement(text: string): string {
    const trimmed = text.trim();
    if (trimmed.length <= 96) return trimmed;
    return `${trimmed.slice(0, 93)}…`;
  }

  const headerActions = (
    <>
      {/* v1.6 G1-3: bitemporal time-travel — Inspector renders the
          memory snapshot at the chosen instant. */}
      <TimeTravelPicker value={asOf} onChange={onAsOfChange} />
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
    </>
  );

  return (
    <div className="space-y-6">
      {/* Compass PageHero — replaces the bespoke header. The subtitle
          wraps the "Mnemosyne" jargon in <TermDef> so curious operators
          can hover for a friendly definition. */}
      <PageHero
        icon={<BrainCircuit />}
        title={tc("pageTitle")}
        subtitle={
          <>
            {tc("pageSubtitlePart1")}
            <TermDef term="mnemosyne">{tc("pageSubtitleTermMnemosyne")}</TermDef>
            {tc("pageSubtitlePart2")}
          </>
        }
        tourId="brain-inspector"
        tourLabel={tc("tourLabel")}
        action={<div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
      />

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
          <div key={k.key} className="rounded-xl border border-line bg-card p-4">
            <span className="text-[10px] uppercase tracking-wider text-faint">
              {k.key === "embedded" ? <TermDef term="embedding">{k.label}</TermDef> : k.label}
            </span>
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

      {/* Pedagogical tip — explains the "forget is safe" property of the
          inspector before the operator starts curating. Dismissible so it
          gets out of the way once internalised. */}
      <Callout variant="tip" title={tc("tip.title")} dismissible>
        {tc("tip.bodyPart1")}
        <strong>{t("actions.forget")}</strong>
        {tc("tip.bodyPart2")}
      </Callout>

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
        <CompassEmptyState
          icon={<BrainCircuit className="h-5 w-5" />}
          title={tEmpty("title")}
          body={tEmpty("body")}
          primaryCta={{
            label: t("empty.ctaLabel"),
            href: `/${locale}/${ws}/settings/ai-providers`,
          }}
        />
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

      {/* Next steps — passive nudges toward adjacent surfaces. Not a CTA
          because the user might be mid-curation; these just lower the
          discovery cost. */}
      <section aria-labelledby="brain-next-steps" className="pt-2">
        <h2
          id="brain-next-steps"
          className="mb-3 text-[10px] font-medium uppercase tracking-wider text-faint"
        >
          {tc("nextStepsTitle")}
        </h2>
        <NextStepGroup className="lg:grid-cols-2">
          <NextStep
            icon={<ClipboardCheck className="h-4 w-4" />}
            title={tc("nextSteps.review.title")}
            body={tc("nextSteps.review.body")}
            href={`/${locale}/${ws}/brain/review`}
            estimateMinutes={5}
          />
          <NextStep
            icon={<Wrench className="h-4 w-4" />}
            title={tc("nextSteps.housekeeping.title")}
            body={tc("nextSteps.housekeeping.body")}
            href={`/${locale}/${ws}/settings/memory`}
            estimateMinutes={3}
          />
        </NextStepGroup>
      </section>

      <EditFactDialog
        fact={editing}
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        onSaved={handleEdited}
      />

      {/* Destructive action — wrapped in ConfirmAction so the user sees
          the exact statement, scope, and reversibility before forgetting. */}
      <ConfirmAction
        open={forgetTarget !== null}
        onClose={() => {
          if (!forgetPending) setForgetTarget(null);
        }}
        title={tc("forget.title")}
        description={tc("forget.description")}
        action={tc("forget.action")}
        cancelLabel={tc("forget.cancel")}
        tone="destructive"
        isPending={forgetPending}
        onConfirm={confirmForget}
        impact={
          forgetTarget
            ? [
                {
                  label: tc("forget.impactStatement"),
                  value: previewStatement(forgetTarget.statement),
                },
                {
                  label: tc("forget.impactScope"),
                  value: t(`filters.scope_${forgetTarget.scope}`),
                },
                {
                  label: tc("forget.impactReversibility"),
                  value: tc("forget.reversibleValue"),
                },
              ]
            : []
        }
      />
    </div>
  );
}
