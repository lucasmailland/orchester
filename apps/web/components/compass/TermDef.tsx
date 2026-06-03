"use client";

/**
 * TermDef — inline glossary tooltip for Compass jargon.
 *
 * Design intent
 * -------------
 * Compass surfaces (Brain, Memory ops, Flows, Channels…) inevitably leak
 * technical vocabulary: Mnemosyne, embedding, cosine, REM, MCP, RAG, pgvector.
 * The Compass Voice guide forbids dropping these on a new user without context,
 * but rewriting every sentence to avoid them would be condescending and verbose.
 *
 * TermDef is the compromise: wrap the term inline, keep the sentence intact,
 * and let curious users hover (or focus + Enter) to read a friendly, locale-aware
 * definition sourced from `lib/compass/terms.ts`. Visually, a dotted underline
 * signals "there is more here" without screaming for attention.
 *
 * When to use this
 * ----------------
 *   - Inline jargon inside body copy, headers, table cells.
 *   - Any term that already exists in `COMPASS_TERMS`.
 *
 * When NOT to use this
 * --------------------
 *   - Full callouts / explainer boxes → use a dedicated `Callout` instead.
 *   - Field-level help (form labels) → HeroUI `Tooltip` on a help icon is clearer.
 *   - Term not in the dictionary → add it to `COMPASS_TERMS` first; never inline
 *     a one-off definition, that defeats the i18n + consistency promise.
 *
 * Accessibility
 * -------------
 *   - The trigger is a real `<button>` so keyboard users get it for free.
 *   - `aria-describedby` points to the popover, announced by screen readers.
 *   - `Esc` closes; `Tab` cycles through the popover (HeroUI handles focus trap).
 *   - The dotted underline is paired with `aria-label` so the affordance is
 *     conveyed without relying on the visual cue alone.
 */

import { Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { useLocale } from "next-intl";
import { useId, useState, type JSX, type ReactNode } from "react";

import { COMPASS_TERMS, type CompassLocale, type CompassTermKey } from "@/lib/compass/terms";
import { APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface TermDefProps {
  /** Key into `COMPASS_TERMS`. Strict — typos surface at compile time. */
  term: CompassTermKey;
  /** The inline text the user sees (the jargon word itself). */
  children: ReactNode;
  /** Extra classes on the trigger. Use sparingly — defaults already match body copy. */
  className?: string;
}

const SUPPORTED_LOCALES: readonly CompassLocale[] = ["en", "es", "pt-BR"];

function resolveLocale(raw: string): CompassLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(raw) ? (raw as CompassLocale) : "en";
}

export function TermDef({ term, children, className }: TermDefProps): JSX.Element {
  const definition = COMPASS_TERMS[term];
  const rawLocale = useLocale();
  const locale = resolveLocale(rawLocale);
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);

  const shortText = definition.short[locale];
  const longText = definition.long?.[locale];
  const href = definition.href;

  return (
    <Popover
      placement="top"
      showArrow
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      classNames={{
        content: "p-0 border-0 bg-transparent shadow-none",
      }}
    >
      <PopoverTrigger>
        <button
          type="button"
          aria-describedby={isOpen ? popoverId : undefined}
          aria-expanded={isOpen}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          className={cn(
            "inline cursor-help bg-transparent p-0 text-left font-inherit",
            "underline decoration-dotted decoration-muted/60 underline-offset-[3px]",
            "transition-colors duration-150 ease-out",
            "hover:decoration-violet-500 focus:decoration-violet-500",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:rounded-sm",
            className
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <AnimatePresence>
          {isOpen ? (
            <motion.div
              id={popoverId}
              role="tooltip"
              initial={{ opacity: 0, y: 4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.18, ease: APPLE_EASE }}
              className={cn(
                "max-w-xs rounded-xl border border-line bg-elevated p-3 shadow-2xl",
                "text-sm leading-relaxed text-body"
              )}
            >
              <p className="font-medium text-strong">{children}</p>
              <p className="mt-1 text-body">{shortText}</p>
              {longText ? <p className="mt-2 text-xs text-muted">{longText}</p> : null}
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(
                    "mt-2 inline-flex items-center gap-1 text-xs font-medium",
                    "text-violet-500 hover:text-violet-600",
                    "transition-colors duration-150 ease-out",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:rounded-sm"
                  )}
                >
                  {href.replace(/^https?:\/\//, "")}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </PopoverContent>
    </Popover>
  );
}
