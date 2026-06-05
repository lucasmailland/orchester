import "server-only";

/**
 * whats-new.ts — server-only CHANGELOG.md ingestion for the HelpDrawer.
 *
 * Parses the project-root `CHANGELOG.md` (release-please / Keep a Changelog
 * style) into a small, UI-friendly shape. We deliberately keep the parser
 * tolerant: anything we can't make sense of is dropped silently so the
 * drawer can degrade to an empty state rather than crash.
 *
 * Headings recognised:
 *   ## [1.0.0] - 2026-05-28
 *   ## [1.0.0] — 2026-05-28
 *   ## [Unreleased]
 *   ## 1.0.0 - 2026-05-28
 *
 * "Bullets" are any lines starting with `-`, `*`, or `+` inside the
 * section body. We take the first 4 to keep payloads tiny.
 *
 * Caching: in-process 60-second TTL. CHANGELOG.md is rewritten only by
 * release-please commits, so this is generous enough to be effectively
 * free while still letting devs see edits within a minute.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Single release entry, as consumed by the HelpDrawer "What's new" section. */
export interface WhatsNewEntry {
  /** Version string from the heading, e.g. "1.0.0" or "Unreleased". */
  version: string;
  /** ISO-ish date from the heading (`YYYY-MM-DD`) or `null` if absent. */
  date: string | null;
  /** Up to 4 leading bullets from the section body, plain text. */
  bullets: string[];
  /** Optional permalink — populated when CHANGELOG_URL env is set. */
  url?: string;
}

/** Cache TTL in milliseconds. */
const CACHE_TTL_MS = 60_000;
/** In-memory cache key. Single global entry: there's only one CHANGELOG. */
const CACHE_KEY = "changelog:root";

interface CacheCell {
  expiresAt: number;
  value: WhatsNewEntry[];
}

const cache = new Map<string, CacheCell>();

/**
 * Resolve candidate CHANGELOG.md paths. In Next.js dev `cwd` is usually
 * `apps/web`; in standalone output it varies — try the known locations.
 */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    join(cwd, "CHANGELOG.md"),
    join(cwd, "..", "..", "CHANGELOG.md"),
    join(cwd, "..", "CHANGELOG.md"),
  ];
}

async function readChangelog(): Promise<string | null> {
  for (const p of candidatePaths()) {
    try {
      return await readFile(p, "utf8");
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Parse the first `limit` release sections out of a CHANGELOG body.
 */
function parseChangelog(md: string, limit: number): WhatsNewEntry[] {
  const lines = md.split(/\r?\n/);
  const entries: WhatsNewEntry[] = [];

  const headingRe =
    /^##\s+(?:\[([^\]]+)\]|([0-9]+\.[0-9]+\.[0-9]+))(?:\s*[-—–]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
  const bulletRe = /^\s*[-*+]\s+(.+?)\s*$/;
  const baseUrl = process.env.CHANGELOG_URL?.trim();

  let current: WhatsNewEntry | null = null;

  for (const line of lines) {
    const head = headingRe.exec(line);
    if (head) {
      if (current) entries.push(current);
      if (entries.length >= limit) {
        current = null;
        break;
      }
      const version = (head[1] ?? head[2] ?? "").trim();
      const date = head[3] ?? null;
      current = { version, date, bullets: [] };
      if (baseUrl) {
        const anchor = version
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        current.url = `${baseUrl}#${anchor}`;
      }
      continue;
    }
    if (!current) continue;
    if (current.bullets.length >= 4) continue;
    const bullet = bulletRe.exec(line);
    if (bullet && bullet[1]) {
      const text = bullet[1]
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
      if (text) current.bullets.push(text);
    }
  }
  if (current && entries.length < limit) entries.push(current);

  return entries;
}

/**
 * Return the most recent release entries (up to 5). Cached for 60s.
 * Never throws: on read or parse failure returns an empty array.
 */
export async function getWhatsNew(): Promise<WhatsNewEntry[]> {
  const now = Date.now();
  const hit = cache.get(CACHE_KEY);
  if (hit && hit.expiresAt > now) return hit.value;

  try {
    const md = await readChangelog();
    if (md === null) {
      cache.set(CACHE_KEY, { expiresAt: now + CACHE_TTL_MS, value: [] });
      return [];
    }
    const value = parseChangelog(md, 5);
    cache.set(CACHE_KEY, { expiresAt: now + CACHE_TTL_MS, value });
    return value;
  } catch {
    cache.set(CACHE_KEY, { expiresAt: now + CACHE_TTL_MS, value: [] });
    return [];
  }
}
