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

import { Callout } from "@/components/compass/Callout";
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

// Race window — when a tour is requested, late-mounting TourSpots (Suspense
// boundaries, lazy chunks) may not be in the registry yet. We watch the
// registry until it stops changing for SETTLED_SNAPSHOT_MS, then lock the
// snapshot. We bail after MAX_SNAPSHOT_WAIT_MS regardless, surfacing a
// warning Callout in the tour card so the user knows steps may be missing.
const SETTLED_SNAPSHOT_MS = 250;
const MAX_SNAPSHOT_WAIT_MS = 2000;
// Per-step rect-not-yet-visible wait. requestAnimationFrame ticks for at most
// this long before we declare the spot "not on the current page" and skip.
const REC_WAIT_MAX_MS = 500;
const SPOT_ATTR = "data-compass-spot" as const;

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

/**
 * Stable sort + dedupe a snapshot by id. Used every time the registry or the
 * MutationObserver fires, so callers never have to assume any prior ordering
 * survives. Step number is the primary sort key; id is the deterministic
 * tie-breaker so reorderings are idempotent.
 */
function sortAndDedupe(entries: ReadonlyArray<TourSpotEntry>): ReadonlyArray<TourSpotEntry> {
  const byId = new Map<string, TourSpotEntry>();
  for (const e of entries) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) =>
    a.step === b.step ? a.id.localeCompare(b.id) : a.step - b.step
  );
}

/**
 * Build a TourSpotEntry from a raw DOM element discovered by the
 * MutationObserver fallback. These entries have no title/body (no React
 * component owns them) so they're placeholders unless the React registry
 * later supplies the same id with real copy.
 */
function entryFromDomNode(el: HTMLElement, tourId: string): TourSpotEntry | null {
  const id = el.getAttribute(SPOT_ATTR);
  if (!id) return null;
  if (id !== tourId && !id.startsWith(`${tourId}:`)) return null;
  // Derive a step number from the `:stepN` suffix when present, else 999 so
  // it lands at the end of the ordering rather than colliding with step 1.
  const match = /:step(\d+)$/.exec(id);
  const step = match && match[1] ? Number.parseInt(match[1], 10) : 999;
  return {
    id,
    step,
    title: "",
    body: "",
    getRect: () => (el.isConnected ? el.getBoundingClientRect() : null),
  };
}

/** True when a rect is too small to highlight (not yet laid out / display:none). */
function isRectEmpty(r: DOMRect | null): boolean {
  return !r || r.width === 0 || r.height === 0;
}

/**
 * Wait up to REC_WAIT_MAX_MS rAF ticks for `entry.getRect()` to return a
 * non-empty rect. Resolves with the rect when ready, or `null` if the
 * deadline elapses with the spot still invisible. SSR-safe: returns `null`
 * immediately when window is unavailable.
 */
function waitForRect(entry: TourSpotEntry): Promise<DOMRect | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (): void => {
      const r = entry.getRect();
      if (!isRectEmpty(r)) {
        resolve(r);
        return;
      }
      if (performance.now() - start >= REC_WAIT_MAX_MS) {
        resolve(null);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
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

  // True after the settled-snapshot window (or hard cap) elapses with at
  // least one missing-or-late step. Drives the warning Callout in the card.
  const [missingStepsWarning, setMissingStepsWarning] = useState(false);
  // True for the current step iff its rect never materialised within
  // REC_WAIT_MAX_MS. Drives the per-step "not on this page" note.
  const [currentStepSkipped, setCurrentStepSkipped] = useState(false);

  const rafRef = useRef<number | null>(null);
  // Tracks the highest step count seen during the settle window so we can
  // tell whether the final snapshot lost steps (warning) or just settled
  // promptly at the expected size.
  const peakStepsRef = useRef(0);

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
    setMissingStepsWarning(false);
    setCurrentStepSkipped(false);
    peakStepsRef.current = 0;
  }, []);

  // Listen for the global `compass:tour` event. We *always* activate, even
  // if the initial registry snapshot is empty — late-mounting TourSpots
  // (Suspense boundaries, lazy chunks) join the active tour through the
  // subscription / MutationObserver below. The previous `bail-on-empty`
  // behaviour silently dropped tours whose steps mounted a tick late.
  useEffect(() => {
    const win = target ?? (typeof window !== "undefined" ? window : null);
    if (!win) return;

    const handler = (evt: Event): void => {
      const detail = (evt as CompassTourEvent).detail;
      if (!detail || typeof detail.tourId !== "string") return;
      const matching = sortAndDedupe(filterByTour(getTourSpots(), detail.tourId));
      setActiveTourId(detail.tourId);
      setSteps(matching);
      setIndex(0);
      setMissingStepsWarning(false);
      setCurrentStepSkipped(false);
      peakStepsRef.current = matching.length;
    };

    win.addEventListener(TOUR_EVENT, handler as EventListener);
    return () => {
      win.removeEventListener(TOUR_EVENT, handler as EventListener);
    };
  }, [target]);

  // Settle the snapshot. While a tour is active we (1) subscribe to the
  // React TourSpot registry, (2) attach a MutationObserver as a fallback for
  // portal / non-React mounts, (3) reset a settle timer on every change; the
  // snapshot is "locked" once nothing changes for SETTLED_SNAPSHOT_MS, and
  // hard-capped at MAX_SNAPSHOT_WAIT_MS. Late mounts after settle still flow
  // through (subscription keeps the latest steps), but we stop expecting
  // more so the warning Callout can decide whether to surface.
  useEffect(() => {
    if (!activeTourId) return;
    if (typeof window === "undefined") return;

    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let hardCapTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    // Merge React registry + DOM observer snapshots into a single stable
    // step list. The React registry wins on copy; DOM-only entries are
    // placeholders for spots we know exist but whose component hasn't
    // registered yet (rare — usually portal mounts).
    const buildSnapshot = (): ReadonlyArray<TourSpotEntry> => {
      const reactEntries = filterByTour(getTourSpots(), activeTourId);
      const domNodes = document.querySelectorAll<HTMLElement>(`[${SPOT_ATTR}]`);
      const merged: TourSpotEntry[] = [...reactEntries];
      const seen = new Set(reactEntries.map((e) => e.id));
      domNodes.forEach((el) => {
        const entry = entryFromDomNode(el, activeTourId);
        if (entry && !seen.has(entry.id)) {
          merged.push(entry);
          seen.add(entry.id);
        }
      });
      return sortAndDedupe(merged);
    };

    const apply = (next: ReadonlyArray<TourSpotEntry>): void => {
      peakStepsRef.current = Math.max(peakStepsRef.current, next.length);
      setSteps(next);
      setIndex((i) => (next.length === 0 ? 0 : Math.min(i, next.length - 1)));
    };

    const lockSnapshot = (): void => {
      if (settled) return;
      settled = true;
      if (settleTimer) clearTimeout(settleTimer);
      if (hardCapTimer) clearTimeout(hardCapTimer);
      const final = buildSnapshot();
      apply(final);
      if (final.length < peakStepsRef.current || final.length === 0) {
        setMissingStepsWarning(true);
      }
    };

    const onChange = (): void => {
      const next = buildSnapshot();
      apply(next);
      if (settled) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(lockSnapshot, SETTLED_SNAPSHOT_MS);
    };

    // Initial sample + arm timers.
    apply(buildSnapshot());
    settleTimer = setTimeout(lockSnapshot, SETTLED_SNAPSHOT_MS);
    hardCapTimer = setTimeout(lockSnapshot, MAX_SNAPSHOT_WAIT_MS);

    const unsub = subscribeTourSpots(onChange);
    // MutationObserver fallback: catches portal / non-React mounts that
    // bypass the registry. Watches subtree for nodes carrying the
    // data-compass-spot attribute (added or removed).
    const observer = new MutationObserver(() => {
      onChange();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [SPOT_ATTR],
    });

    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (hardCapTimer) clearTimeout(hardCapTimer);
      observer.disconnect();
      unsub();
    };
  }, [activeTourId]);

  const currentStep: TourSpotEntry | null = steps[index] ?? null;

  // Smoothly scroll the target into view whenever the step changes.
  useLayoutEffect(() => {
    if (!currentStep) return;
    const r = currentStep.getRect();
    if (!r) return;
    const offscreen =
      r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth;
    if (offscreen) {
      const sel = `[${SPOT_ATTR}="${CSS.escape(currentStep.id)}"]`;
      const el = document.querySelector<HTMLElement>(sel);
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
  }, [currentStep]);

  // Per-step rect resilience: when a step is reached but its DOM rect is
  // empty (Suspense still resolving, transition mid-flight), wait up to
  // REC_WAIT_MAX_MS for it to materialise. If it still hasn't shown up,
  // auto-advance with the "not on this page" Callout note in the card.
  useEffect(() => {
    setCurrentStepSkipped(false);
    if (!currentStep) return;
    let cancelled = false;
    void waitForRect(currentStep).then((r) => {
      if (cancelled) return;
      if (r) return; // rAF loop below will pick it up
      // Empty after the deadline → mark this step skipped and advance.
      setCurrentStepSkipped(true);
      if (index < steps.length - 1) {
        setIndex((i) => i + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentStep, index, steps.length]);

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

  if (!mounted || !activeTourId) return null;

  // Empty-state card: activated but the snapshot settled with no usable
  // steps. Render a centered Callout so the user gets actionable feedback
  // instead of a silently dropped tour.
  if (!currentStep) {
    if (!missingStepsWarning) return null;
    const centeredCardStyle: CSSProperties = {
      position: "fixed",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: CARD_WIDTH,
      zIndex: 1001,
    };
    return createPortal(
      <motion.div
        role="dialog"
        aria-modal="false"
        aria-label={t("skip")}
        style={centeredCardStyle as Record<string, string | number | undefined>}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: APPLE_EASE }}
        className="rounded-2xl border border-line bg-card shadow-xl backdrop-blur"
      >
        <div className="p-4">
          <Callout variant="warning">{t("runtime.missingStepsWarning")}</Callout>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line/70 px-4 py-3">
          <button
            type="button"
            onClick={skip}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
          >
            {t("finish")}
          </button>
        </div>
      </motion.div>,
      document.body
    );
  }

  if (!rect) return null;

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
          {missingStepsWarning ? (
            <div className="mt-3">
              <Callout variant="warning">{t("runtime.missingStepsWarning")}</Callout>
            </div>
          ) : null}
          {currentStepSkipped ? (
            <div className="mt-3">
              <Callout variant="note">{t("runtime.skippedStepNote")}</Callout>
            </div>
          ) : null}
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
