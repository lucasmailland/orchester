"use client";

/**
 * PlatformTourSection — the "see the real thing" section.
 *
 * Replaces the older hand-rolled `ProductShowcase` mockups with real
 * product screenshots captured by `scripts/capture-screenshots.mts` and
 * served from `/public/screenshots/`.
 *
 * Layout:
 *   Desktop (md+):
 *     [   left rail: scrollable tab list   |       big browser-framed shot       ]
 *     Tabs are grouped by category (Build / Operate / Memory / Insights / Admin).
 *     Active tab is animated with a gradient indicator; image cross-fades.
 *
 *   Mobile (<md):
 *     Vertical stack: category pills row → frame → vertical text below.
 *     Horizontal scroll on the pills row (snap-x).
 *
 * Interactions:
 *   - Click any tab → swaps the image.
 *   - Idle for 6s → auto-advance to the next tab (paused on hover / when off-screen).
 *
 * Accessibility:
 *   - Tabs are real `<button>`s with `aria-pressed` and `aria-controls`.
 *   - Image has descriptive alt per shot.
 *   - Auto-advance is paused by the user's `prefers-reduced-motion` flag.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Activity,
  Brain,
  GitBranch,
  Layers,
  MessagesSquare,
  Network,
  ScrollText,
  Settings2,
  Sparkles,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrowserFrame } from "./BrowserFrame";

/** A single capture in the tour. */
interface TourShot {
  /** Stable identifier — used as i18n key suffix and href anchor. */
  id: string;
  /** Path to the PNG under /public. */
  src: string;
  /** Public-facing path shown in the BrowserFrame URL bar. */
  urlPath: string;
  /** Icon for the left rail. */
  icon: LucideIcon;
  /** Category — drives the section header above the tab in the rail. */
  category: "build" | "operate" | "memory" | "insights" | "admin";
}

// Ordered by funnel relevance, not file number. The first shot is the one
// that loads first / appears on initial paint.
const SHOTS: TourShot[] = [
  // Build
  {
    id: "flowEditor",
    src: "/screenshots/03-flow-editor.png",
    urlPath: "/acme-inc/flows/support-triage",
    icon: Workflow,
    category: "build",
  },
  {
    id: "agents",
    src: "/screenshots/04-agents.png",
    urlPath: "/acme-inc/agents",
    icon: Sparkles,
    category: "build",
  },
  {
    id: "agentDetail",
    src: "/screenshots/05-agent-detail.png",
    urlPath: "/acme-inc/agents/seo-optimizer",
    icon: GitBranch,
    category: "build",
  },

  // Operate
  {
    id: "dashboard",
    src: "/screenshots/01-dashboard.png",
    urlPath: "/acme-inc",
    icon: Activity,
    category: "operate",
  },
  {
    id: "conversations",
    src: "/screenshots/06-conversations.png",
    urlPath: "/acme-inc/conversations",
    icon: MessagesSquare,
    category: "operate",
  },
  {
    id: "flowsList",
    src: "/screenshots/02-flows-list.png",
    urlPath: "/acme-inc/flows",
    icon: Layers,
    category: "operate",
  },

  // Memory
  {
    id: "brain",
    src: "/screenshots/08-brain.png",
    urlPath: "/acme-inc/brain",
    icon: Brain,
    category: "memory",
  },
  {
    id: "knowledge",
    src: "/screenshots/07-knowledge.png",
    urlPath: "/acme-inc/knowledge",
    icon: ScrollText,
    category: "memory",
  },

  // Insights
  {
    id: "usage",
    src: "/screenshots/10-usage.png",
    urlPath: "/acme-inc/usage",
    icon: Wallet,
    category: "insights",
  },
  {
    id: "org",
    src: "/screenshots/09-org.png",
    urlPath: "/acme-inc/org",
    icon: Users,
    category: "insights",
  },

  // Admin
  {
    id: "settings",
    src: "/screenshots/12-settings.png",
    urlPath: "/acme-inc/settings",
    icon: Settings2,
    category: "admin",
  },
  {
    id: "integrations",
    src: "/screenshots/11-integrations.png",
    urlPath: "/acme-inc/integrations",
    icon: Network,
    category: "admin",
  },
];

const AUTO_ADVANCE_MS = 6000;

export function PlatformTourSection(): JSX.Element {
  const t = useTranslations("marketing.tour");
  const reduceMotion = useReducedMotion();

  // Active shot index — drives both the rail highlight and the frame image.
  const [active, setActive] = useState(0);
  // Pause flag for the auto-advance loop.
  const [paused, setPaused] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  // Pause auto-advance when the section is off-screen.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setPaused(!entry.isIntersecting);
      },
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Auto-advance unless paused, hovered, or the user dislikes motion.
  useEffect(() => {
    if (paused || reduceMotion) return;
    const id = setTimeout(() => setActive((i) => (i + 1) % SHOTS.length), AUTO_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [active, paused, reduceMotion]);

  const activeShot = SHOTS[active]!;

  // Categories in display order — built lazily from SHOTS so adding a shot
  // to a new category just works without touching this list.
  const categories = useMemo(() => {
    const order: TourShot["category"][] = ["build", "operate", "memory", "insights", "admin"];
    return order.map((cat) => ({
      cat,
      shots: SHOTS.map((s, idx) => ({ ...s, idx })).filter((s) => s.category === cat),
    }));
  }, []);

  return (
    <section
      ref={sectionRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative overflow-hidden bg-[#09090B] py-24 sm:py-32"
      aria-labelledby="platform-tour-heading"
    >
      {/* Ambient glow — keeps the section from feeling flat */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-0 -z-10 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-violet-500/[0.07] blur-3xl"
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">
            {t("eyebrow")}
          </p>
          <h2
            id="platform-tour-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl lg:text-5xl"
          >
            {t("heading")}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-zinc-400 sm:text-lg">{t("subhead")}</p>
        </div>

        {/* Mobile category pills (md hidden) */}
        <div className="mt-10 flex gap-2 overflow-x-auto pb-2 md:hidden">
          {SHOTS.map((shot, i) => {
            const Icon = shot.icon;
            const isActive = i === active;
            return (
              <button
                key={shot.id}
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={isActive}
                className={cn(
                  "flex shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-violet-500/60 bg-violet-500/10 text-violet-200"
                    : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t(`shots.${shot.id}.title`)}
              </button>
            );
          })}
        </div>

        {/* Desktop split layout */}
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-[260px_1fr]">
          {/* Left rail */}
          <nav
            aria-label={t("railAriaLabel")}
            className="hidden flex-col gap-6 md:flex"
            role="tablist"
            aria-orientation="vertical"
          >
            {categories.map(({ cat, shots }) => (
              <div key={cat}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  {t(`categories.${cat}`)}
                </h3>
                <ul className="space-y-1">
                  {shots.map((s) => {
                    const Icon = s.icon;
                    const isActive = s.idx === active;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          aria-controls={`tour-panel-${s.id}`}
                          onClick={() => setActive(s.idx)}
                          className={cn(
                            "group/btn flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-all",
                            isActive
                              ? "border-violet-500/40 bg-gradient-to-r from-violet-500/15 to-violet-500/5 text-zinc-100 shadow-[0_0_24px_-12px_rgba(139,92,246,0.4)]"
                              : "border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900/40 hover:text-zinc-200"
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-4 w-4 shrink-0 transition-colors",
                              isActive
                                ? "text-violet-400"
                                : "text-zinc-500 group-hover/btn:text-zinc-300"
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate">{t(`shots.${s.id}.title`)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* Frame + caption */}
          <div className="min-w-0">
            <BrowserFrame
              urlPath={activeShot.urlPath}
              badge={
                <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Live
                </span>
              }
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeShot.id}
                  id={`tour-panel-${activeShot.id}`}
                  role="tabpanel"
                  initial={{ opacity: 0, scale: 1.02 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.99 }}
                  transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
                  className="absolute inset-0"
                >
                  <Image
                    src={activeShot.src}
                    alt={t(`shots.${activeShot.id}.alt`)}
                    fill
                    priority={active === 0}
                    sizes="(min-width: 1024px) 60vw, 100vw"
                    className="object-cover object-top"
                  />
                </motion.div>
              </AnimatePresence>
            </BrowserFrame>

            {/* Caption */}
            <div className="mt-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeShot.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                >
                  <h3 className="font-display text-xl font-semibold text-zinc-100">
                    {t(`shots.${activeShot.id}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    {t(`shots.${activeShot.id}.description`)}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Progress dots — also clickable for skip nav */}
            <div className="mt-6 flex items-center gap-1.5" aria-hidden="true">
              {SHOTS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(i)}
                  tabIndex={-1}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    i === active ? "w-8 bg-violet-400" : "w-2 bg-zinc-700 hover:bg-zinc-600"
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PlatformTourSection;
