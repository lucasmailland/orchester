"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import type { Fact } from "@/lib/hooks/use-brain-facts";

type Tone = "added" | "forgotten" | "updated";

interface Props {
  title: string;
  emptyLabel: string;
  facts: Fact[];
  tone: Tone;
}

const TONE_CLASSES: Record<Tone, { dot: string; ring: string; badge: string; count: string }> = {
  added: {
    dot: "bg-emerald-400",
    ring: "ring-emerald-500/20",
    badge: "bg-emerald-500/15 text-emerald-300",
    count: "text-emerald-300",
  },
  forgotten: {
    dot: "bg-red-400",
    ring: "ring-red-500/20",
    badge: "bg-red-500/15 text-red-300",
    count: "text-red-300",
  },
  updated: {
    dot: "bg-amber-400",
    ring: "ring-amber-500/20",
    badge: "bg-amber-500/15 text-amber-300",
    count: "text-amber-300",
  },
};

export function DiffColumn({ title, emptyLabel, facts, tone }: Props) {
  const classes = TONE_CLASSES[tone];
  const locale = useLocale();
  const params = useParams<{ workspaceSlug: string; locale: string }>();
  const slug = params?.workspaceSlug;
  const localeForLink = params?.locale ?? locale;

  return (
    <section className={cn("rounded-2xl border border-line bg-card p-4 ring-1", classes.ring)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", classes.dot)} aria-hidden />
          <h2 className="text-sm font-semibold text-strong">{title}</h2>
        </div>
        <span className={cn("text-2xl font-bold tabular-nums", classes.count)}>{facts.length}</span>
      </header>

      {facts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-elevated/40 p-4 text-center text-xs text-faint">
          {emptyLabel}
        </p>
      ) : (
        <ol className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {facts.map((fact) => {
            const ts = new Date(fact.updatedAt);
            const day = new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
            }).format(ts);
            return (
              <li
                key={fact.id}
                className="rounded-lg border border-line bg-elevated/60 p-3 hover:border-line/60"
              >
                <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-faint">
                  <span className={cn("rounded px-1.5 py-0.5", classes.badge)}>{fact.kind}</span>
                  <span className="text-faint">·</span>
                  <span>{fact.subject}</span>
                  <span className="text-faint">·</span>
                  <span className="font-mono">{day}</span>
                </div>
                <Link
                  href={`/${localeForLink}/${slug}/brain/${fact.id}`}
                  className="text-xs text-body hover:text-fichap-primary"
                >
                  <span className="line-clamp-2">{fact.statement}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
