"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, BookOpen, BrainCircuit, AlertCircle } from "lucide-react";
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
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";

  const [filters, setFilters] = useState<FactsFilters>(DEFAULT_FILTERS);
  const [editing, setEditing] = useState<Fact | null>(null);
  const { items, total, error, isLoading, hasMore, loadingMore, loadMore, mutate } =
    useBrainFacts(filters);
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

  async function handlePinToggle(fact: Fact) {
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
    try {
      await forgetFact(fact.id);
      notify.success(t("toast.forgotten"));
      void mutate();
    } catch {
      notify.error(t("toast.forgetError"));
    }
  }

  async function handleRestore(fact: Fact) {
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
