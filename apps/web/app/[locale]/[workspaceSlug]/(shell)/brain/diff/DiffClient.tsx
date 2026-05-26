"use client";

import { useState } from "react";
import { GitCompare, RefreshCw } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@heroui/react";
import { DiffColumn } from "@/components/brain/DiffColumn";
import { useBrainDiff, type DiffRange } from "@/lib/hooks/use-brain-diff";

const RANGE_OPTIONS: DiffRange[] = ["7d", "30d"];

export function DiffClient() {
  const t = useTranslations("brain.diff");
  const locale = useLocale();
  const [range, setRange] = useState<DiffRange>("7d");
  const { buckets, summary, window, error, isLoading, mutate } = useBrainDiff({ range });

  const dateFmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const rangeLabel = `${dateFmt.format(window.start)} – ${dateFmt.format(window.end)}`;
  const netClass = summary.net >= 0 ? "text-emerald-300" : "text-red-300";
  const netSign = summary.net >= 0 ? "+" : "";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-fichap-primary" aria-hidden />
            <h1 className="text-xl font-bold text-strong">{t("title")}</h1>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted">{t("subtitle")}</p>
        </div>
        <Button
          size="sm"
          variant="flat"
          onPress={() => mutate()}
          isLoading={isLoading}
          startContent={!isLoading ? <RefreshCw className="h-3.5 w-3.5" /> : null}
        >
          {t("refresh")}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card p-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">
          {t("rangeLabel")}
        </span>
        <div className="flex flex-wrap gap-1">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium transition " +
                (range === r
                  ? "bg-fichap-primary text-white"
                  : "bg-elevated text-muted hover:text-strong")
              }
            >
              {t(`range.${r}`)}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs text-faint">{rangeLabel}</span>
      </div>

      {/* Summary KPI strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-faint">{t("kpi.net")}</p>
          <p className={"mt-1 text-2xl font-bold tabular-nums " + netClass}>
            {netSign}
            {summary.net} {t("kpi.facts")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t("kpi.priorPeriod", { count: summary.priorNet })}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-faint">{t("kpi.topKind")}</p>
          <p className="mt-1 text-2xl font-bold text-strong">
            {summary.topKind ? summary.topKind.kind : t("kpi.empty")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {summary.topKind
              ? t("kpi.topKindDetail", { count: summary.topKind.count })
              : t("kpi.emptyDetail")}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-faint">{t("kpi.topSubject")}</p>
          <p
            className="mt-1 truncate text-2xl font-bold text-strong"
            title={summary.topSubject?.subject}
          >
            {summary.topSubject ? summary.topSubject.subject : t("kpi.empty")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {summary.topSubject
              ? t("kpi.topSubjectDetail", { count: summary.topSubject.count })
              : t("kpi.emptyDetail")}
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          {t("error")}
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-2xl border border-line bg-card"
              aria-hidden
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <DiffColumn
            tone="added"
            title={t("columns.added")}
            emptyLabel={t("emptyAdded")}
            facts={buckets.added}
          />
          <DiffColumn
            tone="forgotten"
            title={t("columns.forgotten")}
            emptyLabel={t("emptyForgotten")}
            facts={buckets.forgotten}
          />
          <DiffColumn
            tone="updated"
            title={t("columns.updated")}
            emptyLabel={t("emptyUpdated")}
            facts={buckets.updated}
          />
        </div>
      )}
    </div>
  );
}
