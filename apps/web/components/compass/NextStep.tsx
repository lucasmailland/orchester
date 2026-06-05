"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { APPLE_EASE } from "@/lib/motion";

/**
 * NextStep — Compass mini-card that suggests the natural next thing to do.
 *
 * Design intent
 * -------------
 * Place at the end of a page or right after a successful action ("you just
 * finished X — here is the most useful Y to do next"). It replaces the dead
 * space that usually follows a completed flow with a low-pressure nudge.
 *
 * Reach for this when:
 *   - the user has just completed something and there is one (or a small set
 *     of) obvious follow-ups
 *   - you want to lower the cost of discovering an adjacent feature
 *
 * Prefer something else when:
 *   - the page has no completion event — use a regular CTA button
 *   - the surface is empty because nothing exists yet — use {@link EmptyState}
 *   - the message is a notification of a transient event — use the toast
 *     helper from `@/lib/toast`
 *   - the suggestion is destructive or irreversible — that belongs in a
 *     confirm dialog, not a passive card
 *
 * Layout
 * ------
 * A single card renders at its natural width. Multiple `NextStep` cards
 * placed as siblings automatically stack as a responsive grid: stack on
 * mobile, two columns from `sm`, three columns from `lg`. The parent only
 * needs to render them next to each other; the grid is handled internally
 * via the exported {@link NextStepGroup} container, or by wrapping siblings
 * in any `grid` parent. See the consumer example for both patterns.
 *
 * Interaction model
 * -----------------
 * - If `href` is set, the entire card is a link. Keyboard activation is
 *   handled natively by the anchor.
 * - If only `onClick` is set, the card becomes a `role="button"` with
 *   `tabIndex=0` and triggers on Enter or Space.
 * - If neither is set, the card is informational only and not focusable.
 *
 * i18n
 * ----
 * All user-facing copy is owned by the consumer via props. The component
 * only hardcodes ARIA fallbacks ("Open" for the trailing chevron and the
 * "minutes" unit appended to `estimateMinutes` in the aria-label). The
 * minutes unit is intentionally short ("min") to stay neutral across EN/ES/
 * PT-BR; pass a fully-formatted localized label via the `body` prop if you
 * need richer time copy.
 */

type NextStepBaseProps = {
  /** Card heading. Required. Provide a translated string from the consumer. */
  title: string;
  /**
   * Optional secondary copy. Accepts a ReactNode so consumers can embed
   * `<TermDef>` tooltips or formatted spans without escaping.
   */
  body?: ReactNode;
  /** Optional time estimate, in minutes. Rendered as a small "Nm" badge. */
  estimateMinutes?: number;
  /** Optional leading icon (a lucide icon, sized h-4 w-4). */
  icon?: ReactNode;
  /** Optional extra classes for the outer container. */
  className?: string;
};

type NextStepLinkProps = NextStepBaseProps & {
  href: string;
  onClick?: never;
};

type NextStepButtonProps = NextStepBaseProps & {
  href?: never;
  onClick: () => void;
};

type NextStepStaticProps = NextStepBaseProps & {
  href?: never;
  onClick?: never;
};

export type NextStepProps = NextStepLinkProps | NextStepButtonProps | NextStepStaticProps;

const MotionLink = motion(Link);
const MotionDiv = motion.div;

const CARD_CLASSES = cn(
  "group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl",
  "border border-line bg-card p-5 text-left",
  "transition-colors duration-150 ease-out",
  "hover:border-violet-500/40 hover:bg-hover",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-app"
);

const HOVER_ANIMATION = { y: -2 };
const TAP_ANIMATION = { y: 0, scale: 0.995 };
const REST_ANIMATION = { y: 0 };
const TRANSITION = { duration: 0.18, ease: APPLE_EASE };

export function NextStep(props: NextStepProps) {
  const { title, body, estimateMinutes, icon, className } = props;
  const href = "href" in props ? props.href : undefined;
  const onClick = "onClick" in props ? props.onClick : undefined;

  const ariaLabel = buildAriaLabel(title, estimateMinutes);

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon ? (
            <span
              aria-hidden="true"
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                "bg-gradient-to-br from-violet-600/20 to-blue-600/10",
                "text-violet-600 dark:text-violet-400",
                "border border-violet-500/15"
              )}
            >
              {icon}
            </span>
          ) : null}
          <h3 className="truncate text-sm font-semibold text-strong">{title}</h3>
        </div>

        {typeof estimateMinutes === "number" && estimateMinutes > 0 ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full",
              "border border-line bg-elevated px-2 py-0.5",
              "text-[11px] font-medium text-muted"
            )}
          >
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            <span>{estimateMinutes}m</span>
          </span>
        ) : null}
      </div>

      {body !== undefined && body !== null ? (
        <div className="text-sm leading-relaxed text-muted">{body}</div>
      ) : null}

      {href || onClick ? (
        <div className="mt-auto flex items-center justify-end pt-1">
          <ArrowRight
            className={cn(
              "h-4 w-4 text-faint transition-all duration-150 ease-out",
              "group-hover:translate-x-0.5 group-hover:text-violet-500",
              "group-focus-visible:translate-x-0.5 group-focus-visible:text-violet-500"
            )}
            aria-hidden="true"
          />
        </div>
      ) : null}
    </>
  );

  if (href) {
    return (
      <MotionLink
        href={href}
        aria-label={ariaLabel}
        className={cn(CARD_CLASSES, className)}
        initial={REST_ANIMATION}
        whileHover={HOVER_ANIMATION}
        whileTap={TAP_ANIMATION}
        transition={TRANSITION}
      >
        {content}
      </MotionLink>
    );
  }

  if (onClick) {
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    };

    return (
      <MotionDiv
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        className={cn(CARD_CLASSES, "cursor-pointer", className)}
        initial={REST_ANIMATION}
        whileHover={HOVER_ANIMATION}
        whileTap={TAP_ANIMATION}
        transition={TRANSITION}
      >
        {content}
      </MotionDiv>
    );
  }

  return (
    <MotionDiv
      className={cn(CARD_CLASSES, "cursor-default", className)}
      initial={REST_ANIMATION}
      transition={TRANSITION}
    >
      {content}
    </MotionDiv>
  );
}

/**
 * Optional convenience container that lays out multiple `NextStep` cards as
 * a responsive grid. Consumers can also use any plain `grid` wrapper.
 */
export function NextStepGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {children}
    </div>
  );
}

function buildAriaLabel(title: string, estimateMinutes?: number): string {
  if (typeof estimateMinutes === "number" && estimateMinutes > 0) {
    // "min" is a neutral abbreviation across EN/ES/PT-BR. Consumers who need
    // a richer label should embed time copy in `body` instead.
    return `${title} — ${estimateMinutes} min`;
  }
  return title;
}
