"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, Circle, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingChecklistState } from "@/lib/db-queries";

/**
 * Phase L.1 first-run checklist.
 *
 * Sits above the dashboard analytics. A fresh self-host operator
 * landing on an empty workspace sees the 5 things to do first — once
 * each one is satisfied (computed server-side in
 * `getOnboardingChecklistState`) the row shows a green checkmark and
 * a "Done" link instead of "Get started".
 *
 * When all 5 are done the entire card collapses to a "workspace ready"
 * banner that the operator can dismiss for good — the dismissal is
 * persisted in `localStorage` under a workspace-scoped key so it
 * survives across sessions and never re-appears for the same
 * workspace, even if a flag flips back to false later (which would
 * only happen if data was deleted).
 *
 * Client component because (a) it needs localStorage for the
 * dismissal flag and (b) keeps the data-fetching server-only via the
 * 5 booleans passed in as props.
 */
type Props = {
  state: OnboardingChecklistState;
  workspaceId: string;
  locale: string;
  workspaceSlug: string;
};

type TaskKey = "createAgent" | "connectProvider" | "setupChannel" | "inviteTeammate" | "firstRun";

interface Task {
  key: TaskKey;
  done: boolean;
  href: string;
}

const DISMISS_KEY_PREFIX = "orchester:onboarding-checklist:dismissed:";

export function OnboardingChecklist({ state, workspaceId, locale, workspaceSlug }: Props) {
  const t = useTranslations("onboarding.checklist");
  const base = `/${locale}/${workspaceSlug}`;

  const tasks: Task[] = useMemo(
    () => [
      { key: "createAgent", done: state.hasAgent, href: `${base}/agents` },
      { key: "connectProvider", done: state.hasProvider, href: `${base}/settings#providers` },
      { key: "setupChannel", done: state.hasChannel, href: `${base}/channels` },
      { key: "inviteTeammate", done: state.hasTeammate, href: `${base}/settings#members` },
      { key: "firstRun", done: state.hasActivity, href: `${base}/flows` },
    ],
    [state, base]
  );

  const totalDone = tasks.filter((task) => task.done).length;
  const allDone = totalDone === tasks.length;

  // Dismissal state — read from localStorage on mount. Render nothing
  // until we know whether the operator has already dismissed the
  // "workspace ready" banner; that avoids a flash of the banner just
  // before it disappears.
  const dismissKey = `${DISMISS_KEY_PREFIX}${workspaceId}`;
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(dismissKey) === "1");
    } catch {
      // localStorage can throw in private mode / iframes. Treat as
      // "not dismissed" — the banner re-appears next time at worst.
    }
    setHydrated(true);
  }, [dismissKey]);

  function handleDismiss() {
    try {
      window.localStorage.setItem(dismissKey, "1");
    } catch {
      // Ignore — best-effort persistence.
    }
    setDismissed(true);
  }

  // Hide entirely once everything is done AND the operator dismissed
  // the celebratory banner.
  if (allDone && (dismissed || !hydrated)) {
    // While we don't know yet (pre-hydration), the safest render is
    // nothing — the dashboard below already conveys "things are
    // working". The very first paint may show nothing for a frame,
    // which is fine.
    return null;
  }

  if (allDone) {
    return (
      <div
        className="relative flex items-center justify-between gap-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4"
        aria-label={t("completed.banner")}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2
            className="text-emerald-500 dark:text-emerald-400"
            size={20}
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-strong">{t("completed.banner")}</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-md p-1.5 text-faint transition-colors hover:bg-zinc-500/10 hover:text-muted"
          aria-label={t("completed.dismiss")}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <section
      className="rounded-2xl border border-line bg-card backdrop-blur-sm"
      aria-labelledby="onboarding-checklist-title"
    >
      <header className="flex items-end justify-between gap-4 px-5 pt-5 pb-3">
        <div>
          <h2
            id="onboarding-checklist-title"
            className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted"
          >
            {t("title")}
          </h2>
          <p className="mt-0.5 text-[10px] text-faint">{t("subtitle")}</p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-faint">
          {totalDone}/{tasks.length}
        </p>
      </header>
      <ul className="divide-y divide-line border-t border-line">
        {tasks.map((task) => (
          <ChecklistRow
            key={task.key}
            taskKey={task.key}
            done={task.done}
            href={task.href}
            titleLabel={t(`tasks.${task.key}.title`)}
            descriptionLabel={t(`tasks.${task.key}.description`)}
            ctaGetStarted={t("cta.getStarted")}
            ctaDone={t("cta.done")}
          />
        ))}
      </ul>
    </section>
  );
}

function ChecklistRow({
  taskKey,
  done,
  href,
  titleLabel,
  descriptionLabel,
  ctaGetStarted,
  ctaDone,
}: {
  taskKey: TaskKey;
  done: boolean;
  href: string;
  titleLabel: string;
  descriptionLabel: string;
  ctaGetStarted: string;
  ctaDone: string;
}) {
  return (
    <li className="flex items-center gap-4 px-5 py-3">
      {/* Icon is decorative — the visible Button below is the focusable
          entry point. */}
      <span aria-hidden="true" className="flex-shrink-0">
        {done ? (
          <CheckCircle2 className="text-emerald-500 dark:text-emerald-400" size={20} />
        ) : (
          <Circle className="text-faint" size={20} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            done ? "text-muted line-through decoration-emerald-500/40" : "text-strong"
          )}
        >
          {titleLabel}
        </p>
        <p className="mt-0.5 text-xs text-faint">{descriptionLabel}</p>
      </div>
      <Link
        href={href}
        data-task={taskKey}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
          done
            ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400"
            : "bg-violet-500/10 text-violet-600 hover:bg-violet-500/15 dark:text-violet-400"
        )}
      >
        {done ? ctaDone : ctaGetStarted}
        {!done && <ArrowRight size={12} aria-hidden="true" />}
      </Link>
    </li>
  );
}
