"use client";

/**
 * PageHero — Top-of-page header for technical Studio surfaces.
 *
 * Design intent
 * -------------
 * Compass pages (Memory, Brain, Flows, Channels, Providers, Knowledge,
 * Agents, Mnemosyne) drop the user straight into dense, jargon-heavy
 * tooling. PageHero is the calm landing strip: a single icon, a clear
 * title, a 2–3 line subtitle that explains *what this page is for in
 * plain language*, and an optional "Take a tour" affordance for the
 * surfaces that need pedagogy.
 *
 * When to reach for it
 *  - Any Studio page that has a title + a one-paragraph "why" subtitle.
 *  - When you want the optional guided-tour button wired to the global
 *    `compass:tour` event so a tour host (e.g. a future TourProvider)
 *    can listen and trigger the right flow.
 *
 * When NOT to reach for it
 *  - Marketing pages → use `marketing/Hero` (centered, larger type).
 *  - Empty states inside a card → use `components/ui/EmptyState`.
 *  - Modal headers → use HeroUI `ModalHeader`.
 *
 * Voice
 * -----
 * The component owns NO user-facing copy. Title, subtitle, action label
 * and tour label all come from the consumer (props), keeping i18n
 * concerns at the page level. The only hardcoded string is the aria
 * fallback for the tour button when no `tourLabel` is provided —
 * "Take a tour" — which matches Compass voice (clear, professional,
 * non-casual).
 *
 * Accessibility
 *  - Renders as `<header role="banner">` so screen readers anchor to it.
 *  - Title is an `<h1>` (one per page; that's the contract).
 *  - Icon is decorative (`aria-hidden`) — its meaning is carried by the
 *    title text right next to it.
 *  - Tour button is a real `<button>` (HeroUI Button) — Enter/Space
 *    activate it; Tab order is natural.
 *  - Motion respects `prefers-reduced-motion` via framer-motion's
 *    built-in handling (no manual override needed).
 */

import { Button } from "@heroui/react";
import { motion, useReducedMotion } from "framer-motion";
import { Compass as CompassIcon } from "lucide-react";
import type { ReactNode } from "react";

import { APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface PageHeroProps {
  /**
   * Optional decorative icon, typically a `lucide-react` icon at h-5 w-5.
   * Rendered in a violet→blue gradient tile to match `EmptyState`.
   * Pass `null` to omit the tile entirely.
   */
  icon?: ReactNode;

  /**
   * The page title. Rendered as `<h1>`. Required — every Studio page
   * has exactly one.
   */
  title: string;

  /**
   * The 2–3 line explanatory subtitle. ReactNode so consumers can embed
   * `<TermDef>` tooltips around jargon (RAG, embedding, etc.) per
   * Compass voice rules.
   */
  subtitle: ReactNode;

  /**
   * When provided, renders a "Take a tour" button that, on press,
   * dispatches `window.dispatchEvent(new CustomEvent("compass:tour",
   * { detail: { tourId } }))`. A tour host elsewhere in the tree
   * listens and runs the matching flow.
   */
  tourId?: string;

  /**
   * Localized label for the tour button. Defaults to the English
   * "Take a tour" aria fallback if omitted — but consumers SHOULD
   * always pass a translated string.
   */
  tourLabel?: string;

  /**
   * Optional custom action node rendered on the right of the header
   * (e.g. a primary CTA, a status chip, a settings button). Renders
   * to the right of — and after — the tour button when both exist.
   */
  action?: ReactNode;

  /** Extra class names for the outer `<header>`. */
  className?: string;
}

const TOUR_EVENT = "compass:tour" as const;

/**
 * Dispatch the tour event on the window. Wrapped so we can guard
 * against SSR (no-op on the server) and so tests can spy on a single
 * function instead of `window.dispatchEvent` directly.
 */
function emitTour(tourId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { tourId } }));
}

export function PageHero({
  icon,
  title,
  subtitle,
  tourId,
  tourLabel,
  action,
  className,
}: PageHeroProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const showIconTile = icon !== null && icon !== undefined;
  const showTour = typeof tourId === "string" && tourId.length > 0;

  // English aria fallback only — consumers should pass `tourLabel`.
  const resolvedTourLabel = tourLabel ?? "Take a tour";

  return (
    <motion.header
      role="banner"
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: APPLE_EASE }}
      className={cn(
        "flex flex-col gap-4 pb-6",
        "sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {showIconTile ? (
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center",
              "rounded-xl border border-line bg-gradient-to-br from-violet-600 to-blue-600",
              "text-white shadow-sm",
              "[&>svg]:h-5 [&>svg]:w-5"
            )}
          >
            {icon ?? <CompassIcon />}
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1
            className={cn("text-2xl font-semibold tracking-tight text-strong", "sm:text-[1.6rem]")}
          >
            {title}
          </h1>
          <p className={cn("mt-1.5 max-w-2xl text-sm leading-relaxed text-muted")}>{subtitle}</p>
        </div>
      </div>

      {(showTour || action) && (
        <div className="flex shrink-0 items-center gap-2 sm:pt-1">
          {showTour ? (
            <Button
              type="button"
              variant="bordered"
              size="sm"
              radius="md"
              onPress={() => emitTour(tourId)}
              aria-label={resolvedTourLabel}
              data-compass-tour-id={tourId}
            >
              {resolvedTourLabel}
            </Button>
          ) : null}
          {action}
        </div>
      )}
    </motion.header>
  );
}

export default PageHero;
