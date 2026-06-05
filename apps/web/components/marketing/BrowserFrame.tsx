"use client";

/**
 * BrowserFrame — wraps a screenshot in a faux browser chrome.
 *
 * Visual goals:
 *  - Convey "this is a real product, navigable, not a marketing mockup."
 *  - Stay dark-mode-native so it blends with the landing's `#09090B` bg.
 *  - Keep the chrome lightweight — the screenshot is the star.
 *
 * Three subtle anchors sell the realism:
 *   1. macOS-style traffic lights (red / amber / green) on the left.
 *   2. A pill-shaped URL bar that displays the public-facing slug
 *      (orchester.app/…) instead of the dev-server origin.
 *   3. A right-aligned status block (lock icon + tab count).
 *
 * Accessibility:
 *   - The image gets the caller's `alt` text.
 *   - The URL is decorative (`aria-hidden`) — sighted users see it, screen
 *     readers don't read out "orchester.app/agents" for every tile.
 */

import type { JSX, ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrowserFrameProps {
  /** Path shown in the fake URL bar (without protocol or host). */
  urlPath: string;
  /** Public-facing host. Defaults to `orchester.app`. */
  host?: string;
  /** The screenshot. Pass a Next `<Image>` or plain `<img>`. */
  children: ReactNode;
  /** Extra class for the outer wrapper. */
  className?: string;
  /** Optional badge displayed in the top-right of the chrome (e.g. "Live"). */
  badge?: ReactNode;
}

export function BrowserFrame({
  urlPath,
  host = "orchester.app",
  children,
  className,
  badge,
}: BrowserFrameProps): JSX.Element {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950 shadow-2xl shadow-violet-500/5 ring-1 ring-white/[0.03]",
        className
      )}
    >
      {/* Chrome bar */}
      <div className="flex items-center gap-3 border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900 to-zinc-950 px-3 py-2.5">
        {/* Traffic lights */}
        <div className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]/80" />
        </div>

        {/* URL pill */}
        <div
          aria-hidden="true"
          className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-2.5 text-[11px] text-zinc-400"
        >
          <Lock className="h-2.5 w-2.5 shrink-0 text-emerald-500/70" aria-hidden="true" />
          <span className="truncate font-mono text-zinc-500">
            <span className="text-zinc-300">{host}</span>
            <span className="text-zinc-500">{urlPath}</span>
          </span>
        </div>

        {/* Optional right-side badge */}
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>

      {/* Screenshot — aspect matches the captured viewport so object-cover
          doesn't need to crop weirdly. Captures are taken at 1440×740 logical
          (see scripts/snap-via-sysevents.sh — VIEWPORT_H trims the dock). */}
      <div className="relative aspect-[1440/740] w-full overflow-hidden bg-zinc-950">
        {children}
      </div>
    </div>
  );
}

export default BrowserFrame;
