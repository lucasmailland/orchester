"use client";

/**
 * MemoryHeartbeat — live "your AI is learning automatically" banner.
 *
 * Why this exists
 * ---------------
 * The Brain Inspector looked like a database UI: tons of buttons, a KPI
 * strip, a fact list. Operators read that surface and assumed they
 * had to *manually* feed the system — when in reality the Mnemosyne
 * crons (embed every minute, sweep weekly, compact / decay / dedup /
 * consolidate nightly) do all the work without them. This banner is
 * the calm "the system is alive and working" line that closes the
 * mental gap before the operator scrolls into the buttons.
 *
 * Design choices
 *  - Pulse dot on the left, not a spinner — spinner = "wait for me",
 *    pulse = "I'm alive, keep going."
 *  - The subtitle is the only piece that changes: relative time of the
 *    last health snapshot. Auto-refreshes every 30s so "hace 12 min"
 *    becomes "hace 13 min" without a page reload.
 *  - Soft violet→blue gradient + a faint motion sheen on the
 *    background; turns off under `prefers-reduced-motion`.
 *  - Decorative only. No CTA. Operators shouldn't click here.
 *
 * Data
 *  - `capturedAt` comes from `/api/mnemo/health/latest`. When the route
 *    has never produced a snapshot (cold workspace), we fall back to
 *    the i18n "waiting for the first cycle" copy instead of showing
 *    "Invalid Date" or `null`.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useBrainHealthLatest } from "@/lib/hooks/use-brain-health";
import { cn } from "@/lib/utils";

interface MemoryHeartbeatProps {
  className?: string;
}

/**
 * Build a relative-time string ("hace 12 min", "ahora") that updates
 * automatically. We use the platform's `Intl.RelativeTimeFormat`
 * instead of pulling in a date library to keep the bundle small —
 * Mnemosyne snapshots are at most days old, so day/hour/minute is
 * plenty of granularity.
 */
function useRelativeTime(iso: string | null | undefined, locale: string): string | null {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    // Refresh once a minute. Short enough that the operator sees the
    // banner "breathe" while reading the page; cheap enough that we
    // don't care about CPU.
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    if (!iso) return null;
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return null;
    const deltaSec = Math.round((ts - now) / 1000); // negative — in the past
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const absSec = Math.abs(deltaSec);
    if (absSec < 60) return rtf.format(Math.round(deltaSec), "second");
    if (absSec < 3600) return rtf.format(Math.round(deltaSec / 60), "minute");
    if (absSec < 86_400) return rtf.format(Math.round(deltaSec / 3600), "hour");
    return rtf.format(Math.round(deltaSec / 86_400), "day");
  }, [iso, locale, now]);
}

export function MemoryHeartbeat({ className }: MemoryHeartbeatProps): JSX.Element {
  const t = useTranslations("brain.heartbeat");
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const { snapshot } = useBrainHealthLatest();
  const relative = useRelativeTime(snapshot?.capturedAt, locale);

  // Pick the subtitle:
  //  - very recent (< 90s) → "just now"
  //  - we have a snapshot   → "Updated {time}"
  //  - cold workspace       → "Waiting for the first cycle…"
  let subtitle: string;
  if (snapshot?.capturedAt) {
    const deltaSec = Math.abs(Date.now() - Date.parse(snapshot.capturedAt)) / 1000;
    subtitle = deltaSec < 90 ? t("subtitleNow") : t("subtitleRelative", { time: relative ?? "" });
  } else {
    subtitle = t("subtitleWaiting");
  }

  return (
    <div
      role="status"
      aria-label={t("ariaLabel")}
      aria-live="polite"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-violet-500/20",
        "bg-gradient-to-r from-violet-500/5 via-violet-500/10 to-blue-500/5",
        "px-4 py-3 sm:px-5 sm:py-4",
        className
      )}
    >
      {/* Subtle moving sheen — kept under-saturated so the eye stays on
          the title text. Skipped when the user prefers reduced motion. */}
      {!reduceMotion ? (
        <motion.div
          aria-hidden="true"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
          className="pointer-events-none absolute inset-y-0 -inset-x-1/2 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
        />
      ) : null}

      <div className="relative flex items-center gap-3">
        {/* Pulse dot — concentric ring + filled core, both violet. */}
        <span
          aria-hidden="true"
          className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
        >
          {!reduceMotion ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
          ) : null}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-gradient-to-br from-violet-400 to-blue-400 shadow-[0_0_8px_rgba(139,92,246,0.6)]" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <Activity
              className="h-3.5 w-3.5 shrink-0 text-violet-500"
              aria-hidden="true"
              strokeWidth={2.5}
            />
            <span className="truncate text-sm font-semibold tracking-tight text-strong">
              {t("title")}
            </span>
          </div>
          <span className="truncate text-xs text-muted">{subtitle}</span>
        </div>
      </div>
    </div>
  );
}

export default MemoryHeartbeat;
