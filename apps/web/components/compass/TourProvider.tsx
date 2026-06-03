"use client";

/**
 * TourProvider — Mounts the Compass page-tour engine at the workspace shell.
 *
 * Design intent
 * -------------
 * `PageHero` emits a `window` CustomEvent (`compass:tour`) when the user
 * presses "Take a tour", and `<TourSpot>` instances register the regions
 * worth highlighting. TourProvider is the missing piece between the two:
 *
 *   1. Subscribes to the registry (via `subscribeTourSpots`) to know which
 *      spots are currently mounted for the active page.
 *   2. Listens for `compass:tour` events and, on receipt, opens an overlay
 *      that walks the user through the matching spots in `step` order.
 *
 * The overlay does three things at each step:
 *   - Highlights the target element with a soft violet ring drawn from
 *     `getBoundingClientRect()`, kept in sync via resize/scroll listeners
 *     and a `requestAnimationFrame` loop while open.
 *   - Renders a floating card adjacent to the target with the localized
 *     title and body — bodies come from translation keys (`bodyKey`),
 *     never inline strings, so translators own the copy.
 *   - Exposes Back / Skip / Next controls. Last step's "Next" becomes
 *     "Finish" and persists `compass.tour.completed.<tourId>` to
 *     localStorage. A future "Replay tour" affordance can read it.
 *
 * Keyboard contract: Esc skips, ArrowLeft/ArrowRight move between steps,
 * Enter advances. The card is `role="dialog"` `aria-modal="false"` because
 * the user can still click around — this is pedagogy, not a blocking modal.
 *
 * SSR
 * ---
 * Client component. The registry lives in module scope and is empty on the
 * server; the overlay renders nothing until at least one step is active,
 * and uses `createPortal` only after mount.
 *
 * Voice ownership
 * ---------------
 * This file owns zero user-facing strings except button labels resolved via
 * `compass.tour.*` (skip/next/previous/finish). Step titles and bodies come
 * from the consumer's `titleKey`/`bodyKey` props on `<TourSpot>`, looked up
 * against the active `next-intl` locale tree.
 */

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import {
  getTourSpots,
  subscribeTourSpots,
  type TourSpotEntry,
} from "@/components/compass/TourSpot";
import { APPLE_EASE } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TourProviderProps {
  /**
   * Optional override for the document/window the provider listens on.
   * Defaults to the global `window`. Exposed for tests; production code
   * never sets this.
   */
  target?: Window | null;
}

/** Shape of the `compass:tour` CustomEvent payload. */
export interface CompassTourEventDetail {
  tourId: string;
}

export type CompassTourEvent = CustomEvent<CompassTourEventDetail>;

/** localStorage key for "this user finished tour X". */
export function tourCompletedStorageKey(tourId: string): string {
  return `compass.tour.completed.${tourId}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOUR_EVENT = "compass:tour" as const;
const RING_OFFSET = 6; // pixels of breathing room around the highlighted box
const CARD_GAP = 14; // pixels between ring and card
const CARD_WIDTH = 340;
const CARD_MIN_HEIGHT = 160;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterByTour(
  entries: ReadonlyArray<TourSpotEntry>,
  tourId: string
): ReadonlyArray<TourSpotEntry> {
  return entries
    .filter((e) => e.id === tourId || e.id.startsWith(`${tourId}:`))
    .sort((a, b) => a.step - b.step);
}

interface Placement {
  ringStyle: CSSProperties;
  cardStyle: CSSProperties;
}

/**
 * Compute the ring + card placement for a given rect. The card prefers the
 * space below the rect; if that overflows the viewport, it falls back to
 * above, then right, then left.
 */
function computePlacement(rect: DOMRect): Placement {
  const ringStyle: CSSProperties = {
    position: "fixed",
    left: rect.left - RING_OFFSET,
    top: rect.top - RING_OFFSET,
    width: rect.width + RING_OFFSET * 2,
    height: rect.height + RING_OFFSET * 2,
    pointerEvents: "none",
    zIndex: 1000,
  };

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const cardW = CARD_WIDTH;

  // Below
  let top = rect.bottom + CARD_GAP;
  let left = Math.min(Math.max(rect.left, 12), vw - cardW - 12);

  if (top + CARD_MIN_HEIGHT > vh - 12) {
    // Above
    top = Math.max(rect.top - CARD_GAP - CARD_MIN_HEIGHT, 12);
  }

  const cardStyle: CSSProperties = {
    position: "fixed",
    left,
    top,
    width: cardW,
    zIndex: 1001,
  };

  return { ringStyle, cardStyle };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TourProvider({ target }: TourProviderProps = {}): ReactElement | null {
  const t = useTranslations("compass.tour");
  const tRoot = useTranslations();
  const reduceMotion = useReducedMotion();

  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [steps, setSteps] = useState<ReadonlyArray<TourSpotEntry>>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);

  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback((completed: boolean) => {
    setActiveTourId((current) => {
      if (current && completed && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(tourCompletedStorageKey(current), new Date().toISOString());
        } catch {
          // Quota/private mode — non-fatal; the tour still finishes.
        }
      }
      return null;
    });
    setSteps([]);
    setIndex(0);
    setRect(null);
  }, []);

  // Listen for the global `compass:tour` event. When received, snapshot the
  // current registry filtered to this tourId and open the overlay at step 0.
  useEffect(() => {
    const win = target ?? (typeof window !== "undefined" ? window : null);
    if (!win) return;

    const handler = (evt: Event): void => {
      const detail = (evt as CompassTourEvent).detail;
      if (!detail || typeof detail.tourId !== "string") return;
      const matching = filterByTour(getTourSpots(), detail.tourId);
      if (matching.length === 0) return;
      setActiveTourId(detail.tourId);
      setSteps(matching);
      setIndex(0);
    };

    win.addEventListener(TOUR_EVENT, handler as EventListener);
    return () => {
      win.removeEventListener(TOUR_EVENT, handler as EventListener);
    };
  }, [target]);

  // Stay subscribed to the registry while the tour is open so that
  // late-mounting spots (or unmounts during navigation) are reflected.
  useEffect(() => {
    if (!activeTourId) return;
    const unsub = subscribeTourSpots((entries) => {
      const matching = filterByTour(entries, activeTourId);
      if (matching.length === 0) {
        close(false);
        return;
      }
      setSteps(matching);
      setIndex((i) => Math.min(i, matching.length - 1));
    });
    return unsub;
  }, [activeTourId, close]);

  const currentStep: TourSpotEntry | null = steps[index] ?? null;

  // Smoothly scroll the target into view whenever the step changes.
  useLayoutEffect(() => {
    if (!currentStep) return;
    const r = currentStep.getRect();
    if (!r) return;
    const offscreen =
      r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth;
    if (offscreen) {
      const sel = `[data-compass-spot="${CSS.escape(currentStep.id)}"]`;
      const el = document.querySelector<HTMLElement>(sel);
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
  }, [currentStep]);

  // Keep `rect` in sync via rAF while the tour is open. Plus listen for
  // resize/scroll so the ring tracks the target without sub-pixel drift.
  useEffect(() => {
    if (!currentStep) return;

    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      const r = currentStep.getRect();
      setRect((prev) => {
        if (!r) return prev;
        if (
          prev &&
          prev.left === r.left &&
          prev.top === r.top &&
          prev.width === r.width &&
          prev.height === r.height
        ) {
          return prev;
        }
        return r;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const onResize = (): void => {
      const r = currentStep.getRect();
      if (r) setRect(r);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [currentStep]);

  const isLast = index === steps.length - 1;
  const isFirst = index === 0;

  const goNext = useCallback(() => {
    if (isLast) {
      close(true);
    } else {
      setIndex((i) => i + 1);
    }
  }, [isLast, close]);

  const goBack = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const skip = useCallback(() => {
    close(false);
  }, [close]);

  // Keyboard contract: Esc skips, arrows navigate, Enter advances.
  useEffect(() => {
    if (!activeTourId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTourId, goNext, goBack, skip]);

  if (!mounted || !activeTourId || !currentStep || !rect) return null;

  const { ringStyle, cardStyle } = computePlacement(rect);

  // Resolve copy. Step bodies must come from translation keys — the keys
  // are smuggled through `TourSpot.body` with the `i18n:` prefix convention
  // (see TourSpot). If no key prefix is present we fall back to the literal.
  const resolveCopy = (value: string): string => {
    if (value.startsWith("i18n:")) {
      try {
        return tRoot(value.slice("i18n:".length));
      } catch {
        return value;
      }
    }
    return value;
  };

  const title = resolveCopy(currentStep.title);
  const body = resolveCopy(currentStep.body);

  const counter = t("stepCounter", { current: index + 1, total: steps.length });

  const node = (
    <>
      {/* Soft violet highlight ring with a subtle pulse. */}
      <motion.div
        aria-hidden="true"
        style={ringStyle as Record<string, string | number | undefined>}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{
          opacity: 1,
          scale: 1,
          boxShadow: reduceMotion
            ? "0 0 0 2px rgb(124 58 237 / 0.55), 0 0 0 6px rgb(124 58 237 / 0.18)"
            : [
                "0 0 0 2px rgb(124 58 237 / 0.55), 0 0 0 6px rgb(124 58 237 / 0.18)",
                "0 0 0 2px rgb(124 58 237 / 0.7), 0 0 0 10px rgb(124 58 237 / 0.10)",
                "0 0 0 2px rgb(124 58 237 / 0.55), 0 0 0 6px rgb(124 58 237 / 0.18)",
              ],
        }}
        transition={
          reduceMotion
            ? { duration: 0.2 }
            : {
                boxShadow: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
                opacity: { duration: 0.2 },
                scale: { duration: 0.2, ease: APPLE_EASE },
              }
        }
        className="rounded-xl"
      />

      {/* Floating tour card. */}
      <motion.div
        role="dialog"
        aria-modal="false"
        aria-label={title}
        style={cardStyle as Record<string, string | number | undefined>}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: APPLE_EASE }}
        className="rounded-2xl border border-line bg-card shadow-xl backdrop-blur"
      >
        <div className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-violet-500">{counter}</p>
          <h2 className="mt-1 text-base font-semibold leading-snug text-strong">{title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line/70 px-4 py-3">
          <button
            type="button"
            onClick={skip}
            className="text-xs font-medium text-muted transition hover:text-strong"
          >
            {t("skip")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={isFirst}
              className="rounded-md border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-body transition hover:bg-card disabled:opacity-40"
            >
              {t("previous")}
            </button>
            <button
              type="button"
              onClick={goNext}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
            >
              {isLast ? t("finish") : t("next")}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );

  return createPortal(<AnimatePresence>{node}</AnimatePresence>, document.body);
}

export default TourProvider;
