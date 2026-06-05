"use client";

/**
 * TourSpot — invisible registration marker for the Compass page tour.
 *
 * Design intent
 * -------------
 * The Compass tour is opt-in pedagogy: when a user opens a page for the first time
 * (or asks for the tour), an overlay walks them through the meaningful regions —
 * "this is the recall queue", "this is the embeddings status", etc. To keep tour
 * authoring close to the UI that ships, each region declares itself with a
 * <TourSpot> wrapper instead of being curated in a faraway config file.
 *
 * <TourSpot> does two things and only two things:
 *   1. Tags the wrapped region with `data-compass-spot="<id>"` so the Tour overlay
 *      can resolve a real DOM rect with a single querySelector call.
 *   2. Registers an entry in a module-level registry — `{ id, step, title, body,
 *      getRect }` — so the Tour can iterate spots in step order without crawling
 *      the DOM tree.
 *
 * Visually it is a no-op. We never insert padding, never wrap in a styled element,
 * never block focus or pointer events. The component is render-transparent: if you
 * remove it, the layout is identical.
 *
 * When to reach for this vs. alternatives
 * ---------------------------------------
 * - Use TourSpot when the region is part of the page tour and benefits from
 *   `step + title + body` triplets that the Tour overlay can render verbatim.
 * - Use a plain HeroUI <Tooltip> when you only want hover-on-icon help — not a
 *   guided sequence. TourSpot is heavier (state + subscriptions) than Tooltip.
 * - Use <TermDef> when you want a single jargon term explained inline. TourSpot
 *   marks regions; TermDef marks words.
 *
 * Copy ownership
 * --------------
 * `title` and `body` are passed by the consumer. This component owns no
 * user-facing strings except a `aria-hidden` fallback wrapper. i18n is the
 * caller's job — pass `t("pages.compass.tour.recall.title")` etc.
 *
 * Accessibility
 * -------------
 * The marker is invisible and adds no a11y semantics. The Tour overlay that
 * reads the registry is where focus management, Esc-to-close, and Tab cycling
 * live. We intentionally do NOT add aria-describedby here — that would attach
 * tour copy to the region even when the tour is off.
 */

import { useTranslations } from "next-intl";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TourSpotProps {
  /**
   * Stable identifier. The Tour overlay queries `[data-compass-spot="<id>"]`.
   * Either `id` or the pair `tourId` + `step` can be supplied; when `tourId`
   * is set, the effective id becomes `${tourId}:step${step}` so multiple spots
   * can coexist under a single page-level tour.
   */
  id?: string;
  /**
   * Page-level tour identifier. When set, the matching `PageHero` (with the
   * same `tourId`) renders its "Take a tour" button and the TourProvider
   * iterates this tour's spots in `step` order.
   */
  tourId?: string;
  /** 1-indexed order in which this spot appears in the tour sequence. */
  step: number;
  /**
   * Heading shown by the Tour overlay. Prefer `titleKey` for i18n; this
   * remains as a fallback for existing call sites that pass pre-localized
   * strings.
   */
  title?: string;
  /**
   * Body copy shown by the Tour overlay. Prefer `bodyKey` for i18n; kept as
   * a fallback. Plain string keeps the registry serializable.
   */
  body?: string;
  /**
   * Translation key (resolved against the root `useTranslations()` tree) for
   * the step title. When provided, takes precedence over `title`.
   */
  titleKey?: string;
  /**
   * Translation key for the step body. When provided, takes precedence over
   * `body`. The TourProvider also accepts the `i18n:` smuggling convention,
   * so we forward keys as `i18n:<key>` into the registry — that lets the
   * provider re-resolve them against the active locale without having to
   * subscribe to `useTranslations()` inside the registry.
   */
  bodyKey?: string;
  /** The UI region being marked. Single element preferred (zero DOM shift). */
  children: ReactNode;
}

export interface TourSpotEntry {
  readonly id: string;
  readonly step: number;
  readonly title: string;
  readonly body: string;
  /**
   * Returns the live bounding rect of the spot, or `null` if the spot is not
   * currently mounted in the DOM (e.g. inside a collapsed Drawer).
   */
  getRect: () => DOMRect | null;
}

export type TourSpotListener = (entries: ReadonlyArray<TourSpotEntry>) => void;

// ---------------------------------------------------------------------------
// Module-level registry
// ---------------------------------------------------------------------------
// We key by id so multiple <TourSpot id="x"> instances in a tree (e.g. during
// route transitions where both old and new are briefly mounted) don't double-
// register. Last-mounted wins; the leaving spot's cleanup is a no-op against
// the now-owned entry, which keeps the registry stable across navigation.

const registry = new Map<string, TourSpotEntry>();
const listeners = new Set<TourSpotListener>();

function emit(): void {
  if (listeners.size === 0) return;
  const snapshot = getTourSpots();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

/**
 * Read all currently registered spots, sorted by `step` ascending. Ties are
 * broken by registration order via insertion order of the underlying Map.
 */
export function getTourSpots(): ReadonlyArray<TourSpotEntry> {
  return Array.from(registry.values()).sort((a, b) => a.step - b.step);
}

/**
 * Subscribe to registry changes. Returns an unsubscribe function. Fires once
 * synchronously on next emit — not on subscribe — so consumers should call
 * `getTourSpots()` themselves to seed initial state.
 */
export function subscribeTourSpots(listener: TourSpotListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resolve a single spot by id. Useful for the Tour overlay's "jump to step"
 * affordance. Returns `null` if the spot has not registered yet.
 */
export function getTourSpot(id: string): TourSpotEntry | null {
  return registry.get(id) ?? null;
}

/**
 * Test-only escape hatch. Clears the registry and notifies listeners.
 * Production code should never call this.
 */
export function __resetTourSpotRegistryForTests(): void {
  registry.clear();
  emit();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SPOT_ATTR = "data-compass-spot" as const;

/**
 * Type guard: a ReactElement we can safely augment with extra DOM props.
 * We restrict to intrinsic elements (div, button, …) because component
 * children may not forward arbitrary props/refs onto a DOM node.
 */
function isIntrinsicElement(
  node: ReactNode
): node is ReactElement<Record<string, unknown> & { className?: string }> {
  return isValidElement(node) && typeof node.type === "string";
}

export function TourSpot({
  id,
  tourId,
  step,
  title,
  body,
  titleKey,
  bodyKey,
  children,
}: TourSpotProps): ReactElement {
  // A ref to whichever real DOM node ends up carrying the data attribute, so
  // `getRect` can read a live rect without re-running querySelector each tick.
  const nodeRef = useRef<HTMLElement | null>(null);

  // Resolve the effective spot id. Callers may pass `id` directly (legacy
  // contract) OR `tourId` + `step` (new contract); the latter produces a
  // stable, collision-free id like `memory-ops:step3`.
  const effectiveId = id ?? (tourId !== undefined ? `${tourId}:step${step}` : null);

  if (effectiveId === null) {
    // Hard fail at the TS level so consumers can't ship a spot with no id.
    throw new Error("<TourSpot> requires either `id` or `tourId`.");
  }

  // Resolve copy. If the consumer passed translation keys, we still try to
  // render at the consumer's site so non-tour readers (e.g. inspector views)
  // see localized strings; but we ALSO smuggle the raw key into the registry
  // (`i18n:<key>`) so the TourProvider can re-resolve against the active
  // locale at presentation time. This sidesteps the "stale-closure" issue
  // where a locale change wouldn't invalidate the registry entry.
  const t = useTranslations();
  const resolvedTitle = (() => {
    if (titleKey) {
      try {
        return t(titleKey);
      } catch {
        return title ?? "";
      }
    }
    return title ?? "";
  })();
  const resolvedBody = (() => {
    if (bodyKey) {
      try {
        return t(bodyKey);
      } catch {
        return body ?? "";
      }
    }
    return body ?? "";
  })();

  // Registry payload: prefer the i18n key form so the provider re-resolves.
  const registryTitle = titleKey ? `i18n:${titleKey}` : resolvedTitle;
  const registryBody = bodyKey ? `i18n:${bodyKey}` : resolvedBody;

  // Stable fallback id for the wrapper span so devs can find it in DevTools.
  const reactId = useId();

  // Build the rect-getter once. It reads through `nodeRef`, falling back to a
  // querySelector so the entry is still useful if the ref hasn't attached yet.
  const getRect = useMemo<TourSpotEntry["getRect"]>(() => {
    return () => {
      const live = nodeRef.current;
      if (live && live.isConnected) {
        return live.getBoundingClientRect();
      }
      if (typeof document === "undefined") return null;
      const found = document.querySelector<HTMLElement>(
        `[${SPOT_ATTR}="${CSS.escape(effectiveId)}"]`
      );
      return found ? found.getBoundingClientRect() : null;
    };
  }, [effectiveId]);

  // Register / update / unregister.
  useEffect(() => {
    const entry: TourSpotEntry = {
      id: effectiveId,
      step,
      title: registryTitle,
      body: registryBody,
      getRect,
    };
    registry.set(effectiveId, entry);
    emit();
    return () => {
      // Only delete if we're still the owner — protects against the
      // "two instances briefly co-mounted during route transition" case.
      const current = registry.get(effectiveId);
      if (current === entry) {
        registry.delete(effectiveId);
        emit();
      }
    };
  }, [effectiveId, step, registryTitle, registryBody, getRect]);

  // Render. Two paths:
  //   - Single intrinsic-element child → cloneElement and inject the data attr
  //     and a ref. Truly zero DOM shift.
  //   - Anything else → wrap in <span style="display:contents"> so the marker
  //     adds no box. Layout is still untouched; we lose direct ref-on-child but
  //     the wrapper itself carries the attribute and the ref.
  // Only take the cloneElement path when children is *exactly* a single
  // intrinsic ReactElement (e.g. <div>, <section>). Text nodes, fragments,
  // arrays, and component-typed elements all flow through the wrapper path.
  if (isIntrinsicElement(children)) {
    const onlyChild = children;
    type Augmented = {
      ref?: (node: HTMLElement | null) => void;
      [SPOT_ATTR]: string;
    };
    const existingRef = (onlyChild.props as { ref?: unknown }).ref;
    const props: Augmented = {
      [SPOT_ATTR]: effectiveId,
      ref: (node: HTMLElement | null) => {
        nodeRef.current = node;
        // Forward to any existing ref the child already had.
        if (typeof existingRef === "function") {
          (existingRef as (n: HTMLElement | null) => void)(node);
        } else if (existingRef && typeof existingRef === "object" && "current" in existingRef) {
          (existingRef as { current: HTMLElement | null }).current = node;
        }
      },
    };
    return cloneElement(onlyChild, props as Partial<typeof onlyChild.props>);
  }

  // Fallback wrapper: display:contents removes the span from the box tree, so
  // flex/grid parents still see the child(ren) as direct descendants.
  return (
    <span
      ref={(node) => {
        nodeRef.current = node;
      }}
      {...{ [SPOT_ATTR]: effectiveId }}
      data-compass-spot-fallback={reactId}
      style={{ display: "contents" }}
    >
      {children}
    </span>
  );
}

export default TourSpot;
