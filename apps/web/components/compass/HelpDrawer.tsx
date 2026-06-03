"use client";

/**
 * HelpDrawer — slide-in panel triggered by the floating HelpButton.
 *
 * Sections, in order:
 *   1. Search — filters help articles built from `COMPASS_TERMS`.
 *   2. On this page — pathname-aware context card.
 *   3. Continue your onboarding — only when localStorage step < 4.
 *   4. What's new — short hardcoded changelog (placeholder).
 *   5. Ask the community — GitHub Discussions link.
 *
 * Accessibility: portal-rendered `role="dialog"` with `aria-modal="true"`.
 * Focus is trapped inside the panel while open and returned to the
 * trigger on close. Escape and click-outside both close.
 *
 * SSR-safe: the portal target is resolved inside `useEffect`, so the
 * component renders `null` until mounted on the client.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { ExternalLink, Search, X } from "lucide-react";
import {
  COMPASS_TERMS,
  getTermLong,
  getTermShort,
  type CompassLocale,
  type CompassTermKey,
} from "@/lib/compass/terms";

/** Public props for {@link HelpDrawer}. */
export interface HelpDrawerProps {
  /** Whether the drawer is visible. Drives focus trap + animations. */
  open: boolean;
  /** Called when the user dismisses via X, Esc, or click-outside. */
  onClose: () => void;
}

/**
 * Pathname matcher table. The first entry whose `test` matches the
 * current pathname wins; otherwise `perPage.default` is used.
 *
 * Entries are intentionally ordered most-specific first so that
 * `/settings/memory` resolves to "memory" instead of falling back
 * to a hypothetical generic settings entry.
 */
const PER_PAGE_RULES: ReadonlyArray<{
  /** i18n leaf under `compass.help.perPage`. */
  key: PerPageKey;
  /** Pathname segment matcher (excludes /{locale}/{workspaceSlug} prefix). */
  test: RegExp;
  /** Optional tour to surface ("Take a tour" CTA dispatches compass:tour). */
  tourId?: string;
}> = [
  { key: "memory", test: /\/settings\/memory(\/|$)/, tourId: "memory-ops" },
  { key: "brain", test: /\/brain(\/|$)/, tourId: "brain-inspector" },
  { key: "flows", test: /\/flows(\/|$)/, tourId: "flows" },
  { key: "channels", test: /\/channels(\/|$)/ },
  { key: "providers", test: /\/settings\/providers(\/|$)/ },
  { key: "knowledge", test: /\/knowledge(-bases)?(\/|$)/, tourId: "knowledgeBases" },
  { key: "agents", test: /\/agents(\/|$)/ },
];

type PerPageKey =
  | "memory"
  | "brain"
  | "flows"
  | "channels"
  | "providers"
  | "knowledge"
  | "agents"
  | "default";

interface PerPageMatch {
  key: PerPageKey;
  tourId?: string;
}

/** Resolve which `perPage.*` block applies to a pathname. */
function matchPerPage(pathname: string | null): PerPageMatch {
  if (!pathname) return { key: "default" };
  for (const rule of PER_PAGE_RULES) {
    if (rule.test.test(pathname)) {
      // exactOptionalPropertyTypes: only include `tourId` when defined,
      // never assign `undefined` to an optional field explicitly.
      const match: PerPageMatch = { key: rule.key };
      if (rule.tourId !== undefined) match.tourId = rule.tourId;
      return match;
    }
  }
  return { key: "default" };
}

/** localStorage key for the onboarding state. */
const ONBOARDING_KEY = "compass.onboarding.state";

/**
 * Shape returned by `GET /api/compass/whats-new`. Mirrors the
 * `WhatsNewEntry` exported from `lib/compass/whats-new.ts`, duplicated
 * here so this client component doesn't pull a `server-only` module.
 */
interface WhatsNewEntry {
  version: string;
  date: string | null;
  bullets: string[];
  url?: string;
}

/** GitHub Discussions surface — single source of truth for the "Ask the community" CTA. */
const COMMUNITY_URL = "https://github.com/lucasmailland/orchester/discussions";

/** Read the onboarding state from localStorage. Returns null on SSR or parse error. */
function readOnboardingStep(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { step?: unknown };
    if (typeof parsed.step === "number") return parsed.step;
    return null;
  } catch {
    return null;
  }
}

/** Article rendered in the search list — derived from a Compass term. */
interface HelpArticle {
  id: CompassTermKey;
  title: string;
  body: string;
  long?: string;
  href?: string;
}

function buildArticles(locale: CompassLocale): ReadonlyArray<HelpArticle> {
  return (Object.keys(COMPASS_TERMS) as CompassTermKey[]).map((id) => {
    // exactOptionalPropertyTypes: build the article shape by only setting
    // optional fields when they have a real value. Setting them to `undefined`
    // is rejected by the compiler under this flag.
    const article: HelpArticle = {
      id,
      title: id.charAt(0).toUpperCase() + id.slice(1),
      body: getTermShort(id, locale),
    };
    const long = getTermLong(id, locale);
    if (long !== undefined) article.long = long;
    const href = COMPASS_TERMS[id].href;
    if (href !== undefined) article.href = href;
    return article;
  });
}

export function HelpDrawer({ open, onClose }: HelpDrawerProps): JSX.Element | null {
  const t = useTranslations("compass.help");
  const localeRaw = useLocale();
  const locale: CompassLocale =
    localeRaw === "es" || localeRaw === "pt-BR" ? (localeRaw as CompassLocale) : "en";
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  // `null` = not yet fetched; `[]` = fetched, no entries (empty state).
  const [whatsNew, setWhatsNew] = useState<WhatsNewEntry[] | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Mount gate for SSR safety + portal target.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Re-read onboarding state every time the drawer opens (cheap, avoids stale UI).
  useEffect(() => {
    if (open) setOnboardingStep(readOnboardingStep());
  }, [open]);

  // Lazy-fetch the changelog on first open. Cached for the lifetime of
  // the component — the CHANGELOG only changes on release-please merges
  // and the API is cached server-side for 60s anyway. Any failure (5xx,
  // network) resolves to `[]` so the section renders its empty state.
  useEffect(() => {
    if (!open || whatsNew !== null) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/compass/whats-new", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!r.ok) {
          if (!cancelled) setWhatsNew([]);
          return;
        }
        const raw = (await r.json()) as unknown;
        if (cancelled) return;
        setWhatsNew(Array.isArray(raw) ? (raw as WhatsNewEntry[]) : []);
      } catch {
        if (!cancelled) setWhatsNew([]);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, whatsNew]);

  // Capture the element that opened the drawer so we can restore focus.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      // Defer focus to ensure the panel is in the DOM.
      const id = window.requestAnimationFrame(() => closeBtnRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
    triggerRef.current?.focus?.();
    return undefined;
  }, [open]);

  // Esc to close + Tab focus trap.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a, button, input, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        // querySelectorAll returns NodeList; under noUncheckedIndexedAccess
        // even known-good indices type-narrow to T | undefined. Guard
        // explicitly so the focus-trap stays sound.
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const articles = useMemo(() => buildArticles(locale), [locale]);
  const filteredArticles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter(
      (a) => a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)
    );
  }, [articles, query]);

  const perPage = useMemo(() => matchPerPage(pathname), [pathname]);

  const startTour = useCallback(
    (tourId: string) => {
      window.dispatchEvent(new CustomEvent("compass:tour", { detail: { tourId } }));
      onClose();
    },
    [onClose]
  );

  const showContinueOnboarding = onboardingStep !== null && onboardingStep < 4;

  // Resolve locale prefix for client-side links (we don't want a hard
  // reload to root locale).
  const localePrefix = `/${localeRaw}`;

  if (!mounted) return null;

  return createPortal(
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-[70] transition-opacity duration-200 ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {/* Click-outside scrim */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className={`absolute right-0 top-0 flex h-full w-full max-w-full flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-200 ease-out sm:w-[420px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-strong">{t("title")}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Search bar */}
          <div className="border-b border-line px-5 py-4">
            <label className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 focus-within:ring-2 focus-within:ring-violet-400">
              <Search className="h-4 w-4 text-muted" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="flex-1 bg-transparent text-sm text-strong placeholder:text-faint outline-none"
                aria-label={t("searchPlaceholder")}
              />
            </label>
            <ul className="mt-3 space-y-1">
              {filteredArticles.length === 0 ? (
                <li className="py-6 text-center text-xs text-muted">{t("empty")}</li>
              ) : (
                filteredArticles.map((a) => (
                  <li key={a.id}>
                    {a.href ? (
                      <a
                        href={a.href}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex flex-col gap-1 rounded-md px-3 py-2 transition-colors hover:bg-elevated"
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium text-strong">
                          {a.title}
                          <ExternalLink
                            className="h-3 w-3 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                            aria-hidden="true"
                          />
                        </span>
                        <span className="text-xs leading-relaxed text-muted">{a.body}</span>
                      </a>
                    ) : (
                      <div className="flex flex-col gap-1 rounded-md px-3 py-2 hover:bg-elevated">
                        <span className="text-sm font-medium text-strong">{a.title}</span>
                        <span className="text-xs leading-relaxed text-muted">
                          {a.long ?? a.body}
                        </span>
                      </div>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* On this page */}
          <section className="border-b border-line px-5 py-4" aria-labelledby="help-onpage-h">
            <h3
              id="help-onpage-h"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted"
            >
              {t("sections.onThisPage")}
            </h3>
            <div className="mt-3 rounded-lg border border-line bg-elevated px-4 py-3">
              <p className="text-sm font-medium text-strong">{t(`perPage.${perPage.key}.title`)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {t(`perPage.${perPage.key}.body`)}
              </p>
              {perPage.tourId ? (
                <button
                  type="button"
                  onClick={() => startTour(perPage.tourId as string)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-strong transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  {t("takeTour")}
                </button>
              ) : null}
              {/* Cmd-K / Ctrl-K nudge — most searches in the help
                  drawer would land in the command bar anyway, so we
                  point users there directly. Clicking dispatches
                  `compass:command-bar` which CommandBarRoot listens
                  for, and closes the drawer so the bar can take
                  focus. */}
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("compass:command-bar"));
                  }
                  onClose();
                }}
                className="mt-3 flex w-full items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-left text-xs text-muted transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <span>{t("commandBarHint")}</span>
                <kbd className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-strong">
                  ⌘K
                </kbd>
              </button>
            </div>
          </section>

          {/* Continue onboarding */}
          {showContinueOnboarding ? (
            <section className="border-b border-line px-5 py-4" aria-labelledby="help-onboarding-h">
              <h3
                id="help-onboarding-h"
                className="text-[10px] font-semibold uppercase tracking-wider text-muted"
              >
                {t("sections.continueOnboarding")}
              </h3>
              <a
                href={`${localePrefix}/onboarding`}
                className="mt-3 flex items-center justify-between rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm font-medium text-strong transition-colors hover:bg-violet-500/15"
              >
                <span>{t("continueCta")}</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
              </a>
            </section>
          ) : null}

          {/* What's new */}
          <section className="border-b border-line px-5 py-4" aria-labelledby="help-news-h">
            <h3
              id="help-news-h"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted"
            >
              {t("sections.whatsNew")}
            </h3>
            {whatsNew && whatsNew.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {whatsNew.slice(0, 3).map((entry) => {
                  // First 2 bullets verbatim — enough to skim, not enough to overwhelm.
                  const bullets = entry.bullets.slice(0, 2);
                  return (
                    <li key={entry.version} className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-strong">
                          {entry.version}
                        </span>
                        {entry.date ? (
                          <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
                            {entry.date}
                          </span>
                        ) : null}
                      </span>
                      {bullets.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {bullets.map((b, i) => (
                            <li key={i} className="text-xs leading-relaxed text-muted">
                              {b}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : whatsNew === null ? (
              // First-open spinner-substitute: thin skeleton lines keep the
              // section's height stable while the fetch resolves.
              <ul className="mt-3 space-y-3" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <span className="h-3 w-16 rounded bg-elevated" />
                    <span className="h-3 w-4/5 rounded bg-elevated/60" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-muted">{t("whatsNew.empty")}</p>
            )}
          </section>

          {/* Ask the community */}
          <section className="px-5 py-4" aria-labelledby="help-community-h">
            <h3
              id="help-community-h"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted"
            >
              {t("sections.askCommunity")}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">{t("askCommunityBody")}</p>
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-center justify-between rounded-lg border border-line bg-elevated px-4 py-3 text-sm font-medium text-strong transition-colors hover:bg-surface"
            >
              <span>{t("humanCta")}</span>
              <ExternalLink className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            </a>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default HelpDrawer;
