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
 * Hover storm prevention
 * ----------------------
 * Open/close intent is funneled through the singleton controller in
 * `lib/compass/term-def-controller.ts`. Every TermDef on the page shares a
 * single active id, so sweeping across multiple terms can never flash multiple
 * popovers — the active one swaps instantly, the rest stay closed. Hover-in is
 * debounced ~120ms, hover-out ~100ms, keyboard / tap force an immediate locked
 * open until the user explicitly dismisses.
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
 *   - `role="tooltip"` on the popover content.
 *   - Enter / Space lock the popover open until Esc or outside click.
 *   - Esc closes regardless.
 *   - On touch devices (no hover), tap toggles — no flaky hover behavior.
 */

import { Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { useLocale } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { COMPASS_TERMS, type CompassLocale, type CompassTermKey } from "@/lib/compass/terms";
import {
  cancelPending,
  forceClose,
  forceOpen,
  requestClose,
  requestOpen,
  subscribe,
} from "@/lib/compass/term-def-controller";
import { APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface TermDefProps {
  /** Key into `COMPASS_TERMS`. Strict — typos surface at compile time. */
  term: CompassTermKey;
  /** The inline text the user sees (the jargon word itself). */
  children: ReactNode;
  /** Extra classes on the trigger. Use sparingly — defaults already match body copy. */
  className?: string;
  /**
   * Debounce before opening on hover/focus. Defaults to 120ms — enough to ignore
   * a mouse just passing over the term, short enough to feel responsive when
   * the user actually pauses.
   */
  openDelayMs?: number;
  /**
   * Debounce before closing on hover-out/blur. Defaults to 100ms — long enough
   * to forgive the gap between trigger and popover, short enough to dismiss
   * promptly when the user moves on.
   */
  closeDelayMs?: number;
}

const SUPPORTED_LOCALES: readonly CompassLocale[] = ["en", "es", "pt"];

function resolveLocale(raw: string): CompassLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(raw) ? (raw as CompassLocale) : "en";
}

/** Detect touch-only devices once on mount, no SSR access. */
function useIsTouchOnly(): boolean {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: none)");
    setIsTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setIsTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isTouch;
}

export function TermDef({
  term,
  children,
  className,
  openDelayMs = 120,
  closeDelayMs = 100,
}: TermDefProps): JSX.Element {
  const definition = COMPASS_TERMS[term];
  const rawLocale = useLocale();
  const locale = resolveLocale(rawLocale);
  const popoverId = useId();
  const controllerId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const isTouchOnly = useIsTouchOnly();

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const shortText = definition.short[locale];
  const longText = definition.long?.[locale];
  const href = definition.href;

  // Subscribe to controller activation — single source of truth.
  useEffect(() => {
    const unsubscribe = subscribe(controllerId, (active) => setIsOpen(active));
    return () => {
      // Make sure we don't leave a dangling close timer for this id.
      cancelPending(controllerId);
      unsubscribe();
    };
  }, [controllerId]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleMouseEnter = useCallback((): void => {
    if (isTouchOnly) return;
    requestOpen(controllerId, open, openDelayMs);
  }, [controllerId, isTouchOnly, open, openDelayMs]);

  const handleMouseLeave = useCallback((): void => {
    if (isTouchOnly) return;
    requestClose(controllerId, close, closeDelayMs);
  }, [closeDelayMs, close, controllerId, isTouchOnly]);

  const handleFocus = useCallback((): void => {
    requestOpen(controllerId, open, openDelayMs);
  }, [controllerId, open, openDelayMs]);

  const handleBlur = useCallback((): void => {
    requestClose(controllerId, close, closeDelayMs);
  }, [closeDelayMs, close, controllerId]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        forceOpen(controllerId, open, { lock: true });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        forceClose(controllerId, close);
      }
    },
    [close, controllerId, open]
  );

  const handleClick = useCallback((): void => {
    // On touch, tap toggles. On pointer, click locks open (keyboard-equivalent).
    if (isOpen) {
      forceClose(controllerId, close);
    } else {
      forceOpen(controllerId, open, { lock: true });
    }
  }, [close, controllerId, isOpen, open]);

  // Outside-click dismissal — only listen while open, only listen once mounted.
  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === "undefined") return;

    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      forceClose(controllerId, close);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [close, controllerId, isOpen]);

  // Keep the popover open while the cursor is over it (it lives outside the
  // trigger, so we need to cancel pending close on enter).
  const handlePopoverMouseEnter = useCallback((): void => {
    if (isTouchOnly) return;
    cancelPending(controllerId);
  }, [controllerId, isTouchOnly]);

  const handlePopoverMouseLeave = useCallback((): void => {
    if (isTouchOnly) return;
    requestClose(controllerId, close, closeDelayMs);
  }, [closeDelayMs, close, controllerId, isTouchOnly]);

  return (
    <Popover
      placement="top"
      showArrow
      isOpen={isOpen}
      // Controlled by the singleton — never let HeroUI toggle behind our back.
      onOpenChange={(next) => {
        if (!next) forceClose(controllerId, close);
      }}
      classNames={{
        content: "p-0 border-0 bg-transparent shadow-none",
      }}
    >
      <PopoverTrigger>
        <button
          ref={triggerRef}
          type="button"
          aria-describedby={isOpen ? popoverId : undefined}
          aria-expanded={isOpen}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
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
              ref={popoverRef}
              id={popoverId}
              role="tooltip"
              onMouseEnter={handlePopoverMouseEnter}
              onMouseLeave={handlePopoverMouseLeave}
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
