"use client";

import { useMemo, useState } from "react";
import { Clock, CalendarRange, RefreshCw } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@heroui/react";
import { TimelineDayGroup } from "@/components/brain/TimelineDayGroup";
import { useBrainTimeline, type TimelineRange } from "@/lib/hooks/use-brain-timeline";
import type { Fact } from "@/lib/hooks/use-brain-facts";

const RANGE_OPTIONS: TimelineRange[] = ["7d", "30d", "90d", "all"];

function groupByDay(facts: Fact[], locale: string): Array<{ day: string; items: Fact[] }> {
  const buckets = new Map<string, Fact[]>();
  const formatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const fact of facts) {
    // Use a locale-aware day key but formatted as ISO `YYYY-MM-DD` for
    // sortability. Intl emits MM/DD/YYYY-ish parts which we re-glue.
    const parts = formatter.formatToParts(new Date(fact.createdAt));
    const y = parts.find((p) => p.type === "year")?.value ?? "0000";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    const key = `${y}-${m}-${d}`;
    const arr = buckets.get(key);
    if (arr) arr.push(fact);
    else buckets.set(key, [fact]);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, items]) => ({ day, items }));
}

export function TimelineClient() {
  const t = useTranslations("brain.timeline");
  const locale = useLocale();
  const [range, setRange] = useState<TimelineRange>("7d");
  const { facts, isLoading, isValidating, error, mutate } = useBrainTimeline({ range });

  const grouped = useMemo(() => groupByDay(facts, locale), [facts, locale]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-fichap-primary" aria-hidden />
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

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3">
        <CalendarRange className="h-4 w-4 text-muted" aria-hidden />
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
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-line bg-card"
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

      {!isLoading && !error && grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-12 text-center">
          <Clock className="mx-auto mb-3 h-8 w-8 text-faint" aria-hidden />
          <p className="text-sm text-muted">{t("empty")}</p>
        </div>
      ) : null}

      {grouped.length > 0 ? (
        <div className="space-y-3">
          {grouped.map((group, idx) => (
            <TimelineDayGroup
              key={group.day}
              day={group.day}
              facts={group.items}
              defaultOpen={idx < 3}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
