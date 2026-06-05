"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronDown, ChevronRight, Trash2, Pin, Plus } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import type { Fact } from "@/lib/hooks/use-brain-facts";

interface Props {
  /** ISO date `YYYY-MM-DD` representing this day in the user's locale. */
  day: string;
  facts: Fact[];
  defaultOpen?: boolean;
}

const KIND_COLORS: Record<string, string> = {
  preference: "bg-violet-500/15 text-violet-300",
  trait: "bg-blue-500/15 text-blue-300",
  event: "bg-emerald-500/15 text-emerald-300",
  relationship: "bg-pink-500/15 text-pink-300",
  skill: "bg-amber-500/15 text-amber-300",
  concern: "bg-red-500/15 text-red-300",
  other: "bg-slate-500/15 text-slate-300",
};

function statusIcon(fact: Fact) {
  if (fact.status === "forgotten") return <Trash2 className="h-3 w-3 text-red-400" aria-hidden />;
  if (fact.pinned) return <Pin className="h-3 w-3 text-violet-400" aria-hidden />;
  return <Plus className="h-3 w-3 text-emerald-400" aria-hidden />;
}

export function TimelineDayGroup({ day, facts, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const t = useTranslations("brain.timeline");
  const locale = useLocale();
  const params = useParams<{ workspaceSlug: string; locale: string }>();
  const slug = params?.workspaceSlug;
  const localeForLink = params?.locale ?? locale;

  const learned = facts.filter((f) => f.status === "active").length;
  const forgotten = facts.filter((f) => f.status === "forgotten").length;

  const dayDate = new Date(`${day}T00:00:00`);
  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dayDate);

  return (
    <section className="rounded-2xl border border-line bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-hover"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-3">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          )}
          <span className="text-sm font-semibold text-strong">{dayLabel}</span>
        </div>
        <span className="shrink-0 text-xs text-muted">
          {t("daySummary", { learned, forgotten })}
        </span>
      </button>

      {open ? (
        <ol className="divide-y divide-line border-t border-line">
          {facts.map((fact) => {
            const ts = new Date(fact.createdAt);
            const time = new Intl.DateTimeFormat(locale, {
              hour: "2-digit",
              minute: "2-digit",
            }).format(ts);
            const source = fact.scope === "conversation" ? fact.scopeRef : null;
            return (
              <li key={fact.id} className="flex items-start gap-3 px-4 py-3 hover:bg-hover/40">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-elevated">
                  {statusIcon(fact)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-faint">
                    <span className="font-mono">{time}</span>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5",
                        KIND_COLORS[fact.kind] ?? KIND_COLORS["other"]
                      )}
                    >
                      {fact.kind}
                    </span>
                    {fact.scope ? (
                      <>
                        <span className="text-faint">·</span>
                        <span>{fact.scope}</span>
                      </>
                    ) : null}
                    {source ? (
                      <>
                        <span className="text-faint">·</span>
                        <Link
                          href={`/${localeForLink}/${slug}/conversations/${source}`}
                          className="truncate text-fichap-primary hover:underline"
                          title={source}
                        >
                          {t("sourceConversation")}
                        </Link>
                      </>
                    ) : null}
                  </div>
                  <Link
                    href={`/${localeForLink}/${slug}/brain/${fact.id}`}
                    className="mt-1 block text-sm text-strong hover:text-fichap-primary"
                  >
                    <span className="line-clamp-2">{fact.statement}</span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
