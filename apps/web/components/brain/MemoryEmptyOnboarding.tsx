"use client";

/**
 * MemoryEmptyOnboarding — the "no facts yet, here's what will happen"
 * empty state for /brain.
 *
 * Replaces the generic Compass `<EmptyState>` we used here before. That
 * one only said "no memories yet, go connect a provider" — accurate but
 * cold. Operators were left wondering whether memory was even a thing
 * that would auto-populate (it is — see MemoryHeartbeat).
 *
 * This component is a tiny pedagogy moment that shows the same three
 * steps as the onboarding wizard, but inline and always-visible. The
 * difference:
 *   - Wizard = one-time, dismissible, modal-blocking
 *   - This = ambient, lives in the page where facts will eventually
 *     materialize, so the operator can come back to it without
 *     re-triggering the wizard.
 *
 * Design notes
 *  - Three numbered tiles in a vertical stack on mobile, horizontal
 *    flow on md+. Each tile = icon + short caption.
 *  - Soft violet-tinted background, dashed border — visually says
 *    "placeholder area" without screaming "error".
 *  - Single CTA: jump to /conversations. We avoid linking to the
 *    wizard re-open because the page already auto-opens it on first
 *    visit; the empty state is for *returning* operators who still
 *    have no data.
 *  - When the workspace is so cold that it has zero conversations
 *    *and* zero agents, the CTA would be misleading. Caller decides
 *    whether to render the CTA via the `showCta` prop — keeps the
 *    primitive dumb.
 */

import type { JSX } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MessagesSquare, BrainCircuit, ListChecks, ArrowRight } from "lucide-react";
import { Button } from "@heroui/react";
import { cn } from "@/lib/utils";

interface MemoryEmptyOnboardingProps {
  /** Base path to /[locale]/[workspaceSlug]. */
  basePath: string;
  /**
   * Show the "Start a conversation" CTA. Hide it when the workspace
   * truly has nothing wired up yet (no agents, no channels) — the link
   * would just bounce the operator to a second empty page.
   */
  showCta?: boolean;
  className?: string;
}

interface Step {
  /** i18n key suffix under `brain.emptyOnboarding` — `step1Title`, etc. */
  num: 1 | 2 | 3;
  icon: JSX.Element;
  tileClass: string;
}

const STEPS: Step[] = [
  {
    num: 1,
    icon: <MessagesSquare className="h-4 w-4" aria-hidden="true" />,
    tileClass: "from-cyan-500/20 to-blue-500/20 text-cyan-300",
  },
  {
    num: 2,
    icon: <BrainCircuit className="h-4 w-4" aria-hidden="true" />,
    tileClass: "from-violet-500/25 to-fuchsia-500/20 text-violet-300",
  },
  {
    num: 3,
    icon: <ListChecks className="h-4 w-4" aria-hidden="true" />,
    tileClass: "from-emerald-500/20 to-teal-500/20 text-emerald-300",
  },
];

export function MemoryEmptyOnboarding({
  basePath,
  showCta = true,
  className,
}: MemoryEmptyOnboardingProps): JSX.Element {
  const t = useTranslations("brain.emptyOnboarding");

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-dashed border-violet-500/25",
        "bg-gradient-to-br from-violet-500/[0.04] via-transparent to-blue-500/[0.04]",
        "px-6 py-10 sm:px-10 sm:py-12",
        className
      )}
    >
      {/* Ambient glow behind the title for a tiny depth cue */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-500/[0.08] blur-3xl"
      />

      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300">
          <BrainCircuit className="h-3 w-3" aria-hidden="true" />
          {/* Reuse the heartbeat label — same meaning ("memory is alive"). */}
          {t("title")}
        </span>
        <p className="mt-4 text-sm leading-relaxed text-muted">{t("body")}</p>
      </div>

      {/* Three-step preview. Single column on mobile, single horizontal
          row on md+ (with little chevrons between, hidden on mobile). */}
      <ol className="mx-auto mt-8 flex max-w-3xl flex-col gap-3 md:flex-row md:items-stretch md:gap-2">
        {STEPS.map((s, i) => (
          <li key={s.num} className="flex flex-1 items-stretch gap-2 md:flex-col md:gap-3">
            <div className="flex flex-1 items-start gap-3 rounded-xl border border-line bg-card/60 p-4 backdrop-blur-sm">
              {/* Number + icon tile */}
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-strong",
                  s.tileClass
                )}
                aria-hidden="true"
              >
                {s.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold tracking-wider text-faint">
                    {String(s.num).padStart(2, "0")}
                  </span>
                  <h4 className="text-sm font-semibold text-strong">{t(`step${s.num}Title`)}</h4>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t(`step${s.num}Body`)}</p>
              </div>
            </div>

            {/* Connector chevron — between tiles only, hidden on mobile
                and after the last item. */}
            {i < STEPS.length - 1 ? (
              <div
                aria-hidden="true"
                className="hidden items-center justify-center text-line md:flex"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {showCta ? (
        <div className="mt-8 flex justify-center">
          <Button
            as={Link}
            href={`${basePath}/conversations`}
            color="primary"
            size="md"
            endContent={<ArrowRight size={14} aria-hidden="true" />}
            className="bg-gradient-to-r from-violet-600 to-blue-600 font-semibold text-white"
          >
            {t("cta")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default MemoryEmptyOnboarding;
