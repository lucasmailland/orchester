"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { APPLE_EASE } from "@/lib/motion";

/**
 * Compass `EmptyState`
 *
 * Friendly placeholder used wherever a section has no content yet. It replaces
 * curt fallbacks like "No data" or "(none)" with a teaching surface: a short
 * title that names what lives here, a body that explains why it matters, and
 * one or two actions that move the user toward filling it.
 *
 * Design intent:
 * - Pedagogical, not punitive. A first-time user should leave the empty state
 *   knowing what this section is for and how to populate it.
 * - Centered, generous padding, dashed border on a `bg-card` surface so it
 *   reads as "a space waiting to be used", not "an error".
 * - Content is fully owned by the consumer (props), so this component is i18n-
 *   neutral and can be reused across every Compass page.
 *
 * When to reach for this vs alternatives:
 * - Use `EmptyState` when a list, board, or section legitimately has zero
 *   items and the user can do something about it.
 * - Use a loading skeleton (HeroUI `Skeleton`) while data is being fetched.
 * - Use an error boundary or inline error card for failures — empty is not
 *   the same as broken.
 * - Use the `<NoProviderBanner />` when the blocker is a missing global
 *   prerequisite (e.g. no AI provider connected), not a per-section void.
 *
 * Accessibility:
 * - Rendered as a `role="status"` region with `aria-live="polite"` so screen
 *   readers announce the empty context when it first appears.
 * - The illustration (if any) is decorative and hidden from AT.
 * - CTAs use HeroUI `Button` (`onPress`) and route through `next/link` when
 *   `href` is provided, so keyboard activation (Enter / Space) and focus
 *   styling come for free.
 */

type EmptyStateCta = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export interface EmptyStateProps {
  /**
   * Compact icon shown inside the gradient tile above the title. Use a 16-20px
   * lucide-react icon. Pass `null`/omit to render no tile.
   */
  icon?: ReactNode;
  /**
   * Short, specific name of what this section holds when populated.
   * Consumer owns the string — pass an i18n value, not a hardcoded literal.
   */
  title: string;
  /**
   * One to two sentences that explain what lives here and why it matters.
   * Accepts ReactNode so consumers can embed `<TermDef>` tooltips for jargon.
   */
  body: ReactNode;
  /** Primary action — the recommended next step. Rendered as a solid button. */
  primaryCta?: EmptyStateCta;
  /** Secondary action — usually a "learn more" or alternate path. */
  secondaryCta?: EmptyStateCta;
  /**
   * Optional larger visual that replaces the small icon tile (e.g. an SVG
   * sketch of the section's filled state). When provided, `icon` is ignored.
   */
  illustration?: ReactNode;
  /** Escape hatch for layout tweaks. Avoid using for visual overrides. */
  className?: string;
  /**
   * Visual weight. Defaults to `"primary"` — the pedagogical, dashed-bordered
   * surface used for first-time empties. Use `"subtle"` when the section
   * already has data elsewhere and a filter just produced zero results: the
   * surface flattens (no border, no gradient tile), padding shrinks, and CTAs
   * de-escalate so the empty doesn't scream over the surrounding UI.
   */
  intensity?: "primary" | "subtle";
}

function CtaButton({
  cta,
  variant,
  intensity,
}: {
  cta: EmptyStateCta;
  variant: "primary" | "secondary";
  intensity: "primary" | "subtle";
}) {
  const isPrimary = variant === "primary";

  // Secondary CTAs degrade to a plain text link in both intensities — adversarial
  // review flagged that even a `variant="light"` button still reads as chrome
  // and competes with the primary action.
  if (!isPrimary) {
    const linkClass =
      "text-sm font-medium text-muted underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none";
    if (cta.href) {
      return (
        <Link href={cta.href} className={linkClass}>
          {cta.label}
        </Link>
      );
    }
    return (
      <button type="button" onClick={cta.onClick} className={linkClass}>
        {cta.label}
      </button>
    );
  }

  // Primary CTA: bold gradient at primary intensity, neutral light button at subtle.
  const isSubtle = intensity === "subtle";
  const className = isSubtle
    ? "font-medium text-body"
    : "bg-gradient-to-r from-violet-600 to-blue-600 font-medium text-white shadow-lg shadow-violet-500/20";

  const sharedProps = {
    size: "sm" as const,
    variant: (isSubtle ? "light" : "solid") as "light" | "solid",
    className,
  };

  if (cta.href) {
    return (
      <Button as={Link} href={cta.href} {...sharedProps}>
        {cta.label}
      </Button>
    );
  }

  return (
    <Button {...sharedProps} {...(cta.onClick ? { onPress: cta.onClick } : {})}>
      {cta.label}
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  primaryCta,
  secondaryCta,
  illustration,
  className,
  intensity = "primary",
}: EmptyStateProps) {
  const hasCta = Boolean(primaryCta) || Boolean(secondaryCta);
  const isSubtle = intensity === "subtle";

  return (
    <motion.section
      role="status"
      aria-live="polite"
      aria-label={typeof title === "string" ? title : undefined}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: APPLE_EASE }}
      className={cn(
        "mx-auto flex w-full max-w-xl flex-col items-center justify-center text-center",
        isSubtle
          ? "gap-3 rounded-xl bg-app/30 px-6 py-8"
          : "gap-6 rounded-2xl border border-dashed border-line bg-card px-8 py-14",
        className
      )}
    >
      {/* Illustration slot is intentionally ignored in subtle mode — filter-empty
          surfaces should not carry hero artwork. */}
      {!isSubtle && illustration ? (
        <div aria-hidden="true" className="flex items-center justify-center">
          {illustration}
        </div>
      ) : icon ? (
        isSubtle ? (
          <div aria-hidden="true" className="flex h-8 w-8 items-center justify-center text-muted">
            {icon}
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="relative flex h-14 w-14 items-center justify-center rounded-2xl"
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-600/25 to-blue-600/15" />
            <div className="absolute inset-0 rounded-2xl border border-violet-500/20" />
            <div className="relative text-violet-600 dark:text-violet-400">{icon}</div>
          </div>
        )
      ) : null}

      <div className={isSubtle ? "space-y-1" : "space-y-2"}>
        <h3 className={cn("font-semibold text-strong", isSubtle ? "text-base" : "text-base")}>
          {title}
        </h3>
        <div
          className={cn(
            "mx-auto max-w-md leading-relaxed text-muted",
            isSubtle ? "text-xs" : "text-sm"
          )}
        >
          {body}
        </div>
      </div>

      {hasCta ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {primaryCta ? (
            <CtaButton cta={primaryCta} variant="primary" intensity={intensity} />
          ) : null}
          {secondaryCta ? (
            <CtaButton cta={secondaryCta} variant="secondary" intensity={intensity} />
          ) : null}
        </div>
      ) : null}
    </motion.section>
  );
}

export default EmptyState;
