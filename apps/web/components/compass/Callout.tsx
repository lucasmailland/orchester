"use client";

/**
 * Callout — Compass design system
 *
 * An inline notice block for surfacing context that belongs *inside* a flow of
 * content (a settings page, a long-form description, a step in a wizard). It is
 * NOT a toast, NOT a modal, NOT a banner.
 *
 * Reach for it when:
 *   - You need to explain *why* a section behaves the way it does without
 *     interrupting the user (variant="note" or "tip").
 *   - You want to warn about a side effect *before* the user takes action
 *     (variant="warning") — but the action itself still lives outside the
 *     callout.
 *   - You want to confirm a steady-state success that should persist on the
 *     page (variant="success"), e.g. "Memory consolidation is enabled".
 *
 * Reach for something else when:
 *   - The message is transient feedback after an action → use `notify` (sonner).
 *   - The message blocks the user until they acknowledge it → use the
 *     ConfirmDialog singleton.
 *   - The whole page has no content to show → use EmptyState.
 *
 * The component owns *no* user-facing copy. The consumer passes `title` and
 * `children`. The only hardcoded strings are accessibility fallbacks for the
 * dismiss control (overridable via `dismissLabel`).
 */

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, Lightbulb, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useCallback, useId, useState, type ReactNode } from "react";

import { APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type CalloutVariant = "tip" | "note" | "warning" | "success";

export interface CalloutProps {
  /** Intent of the callout. Drives the icon, accent color, and default ARIA role. */
  variant: CalloutVariant;
  /** Optional short heading. Renders bold above the body. */
  title?: string;
  /** Rich body content. Paragraphs, links, inline code, lists — all supported. */
  children: ReactNode;
  /** If true, renders a close affordance and removes the callout on activation. */
  dismissible?: boolean;
  /** Called when the user dismisses the callout (button click or Esc on focus). */
  onDismiss?: () => void;
  /** Accessible label for the dismiss button. Defaults to "Dismiss". */
  dismissLabel?: string;
  /** Override the icon. Defaults to a variant-appropriate Lucide icon. */
  icon?: LucideIcon;
  /** Optional className for the outer wrapper. */
  className?: string;
  /** Optional test id, forwarded to the root element. */
  "data-testid"?: string;
}

interface VariantConfig {
  /** Default Lucide icon for the intent. */
  icon: LucideIcon;
  /** Container background, border, and accent ring classes (light + dark). */
  container: string;
  /** Icon color classes (light + dark). */
  iconColor: string;
  /** Title color classes (light + dark). */
  titleColor: string;
  /** ARIA role — `alert` for warnings, `status` for everything else. */
  role: "alert" | "status";
  /** ARIA live region politeness. */
  ariaLive: "polite" | "assertive";
}

const VARIANTS: Record<CalloutVariant, VariantConfig> = {
  tip: {
    icon: Lightbulb,
    container:
      "border-violet-200/70 bg-violet-50/60 dark:border-violet-500/25 dark:bg-violet-500/10",
    iconColor: "text-violet-600 dark:text-violet-400",
    titleColor: "text-violet-900 dark:text-violet-100",
    role: "status",
    ariaLive: "polite",
  },
  note: {
    icon: Info,
    container: "border-line bg-surface dark:border-line dark:bg-elevated",
    iconColor: "text-muted dark:text-muted",
    titleColor: "text-strong",
    role: "status",
    ariaLive: "polite",
  },
  warning: {
    icon: TriangleAlert,
    container: "border-amber-200/80 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
    titleColor: "text-amber-900 dark:text-amber-100",
    role: "alert",
    ariaLive: "assertive",
  },
  success: {
    icon: CheckCircle2,
    container:
      "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-500/25 dark:bg-emerald-500/10",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    titleColor: "text-emerald-900 dark:text-emerald-100",
    role: "status",
    ariaLive: "polite",
  },
};

/**
 * Callout — see file header for design intent.
 */
export function Callout({
  variant,
  title,
  children,
  dismissible = false,
  onDismiss,
  dismissLabel = "Dismiss",
  icon,
  className,
  ...rest
}: CalloutProps) {
  const config = VARIANTS[variant];
  const Icon = icon ?? config.icon;
  const headingId = useId();

  const [visible, setVisible] = useState(true);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!dismissible) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        handleDismiss();
      }
    },
    [dismissible, handleDismiss]
  );

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key="callout"
          role={config.role}
          aria-live={config.ariaLive}
          aria-labelledby={title ? headingId : undefined}
          onKeyDown={handleKeyDown}
          initial={{ opacity: 0, y: -4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.18, ease: APPLE_EASE },
          }}
          exit={{
            opacity: 0,
            y: -4,
            transition: { duration: 0.15, ease: APPLE_EASE },
          }}
          className={cn(
            "relative flex w-full gap-3 rounded-xl border p-4 text-sm",
            "shadow-[0_1px_0_0_rgb(0_0_0/0.02)]",
            config.container,
            className
          )}
          data-variant={variant}
          data-testid={rest["data-testid"]}
        >
          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", config.iconColor)} aria-hidden="true" />
          <div className={cn("min-w-0 flex-1", dismissible && "pr-6")}>
            {title ? (
              <p
                id={headingId}
                className={cn("mb-1 font-semibold leading-snug", config.titleColor)}
              >
                {title}
              </p>
            ) : null}
            <div className="text-body leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-strong [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]">
              {children}
            </div>
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={dismissLabel}
              className={cn(
                "absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md",
                "text-muted transition-colors duration-150",
                "hover:bg-hover hover:text-strong",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
              )}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default Callout;
