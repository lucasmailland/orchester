// packages/mnemosyne/src/recall/render.ts
//
// Compact rendering of recalled facts for prompt injection. The default
// "render every statement as a bullet" approach burns 3–5x more tokens
// than necessary because facts repeat structure ("The user prefers X
// over Y", "The user is based in Z"). Grouping by `kind` and condensing
// to key:value pairs shaves the prompt overhead by ~70% on typical
// preference/trait clusters.
//
// Two output formats:
//   • `structured` (default) — `[kind] k1:v1, k2:v2` lines. One line
//     per kind. Most token-efficient.
//   • `prose` — `[kind] subject: statement` lines. Pass-through-ish;
//     used as a safe fallback when pattern extraction fails AND when
//     callers want to debug what was injected.
//
// Token cap: `maxTokensApprox` is a SOFT limit enforced via a rough
// chars/4 estimate (the same heuristic OpenAI's tokenizer cookbook
// uses for English). We never split mid-line; if a line would overflow
// we stop and emit a trailing "(+N more)" marker.
//
// Pattern extraction strategy: regex-only, deliberately conservative.
// We pull out the common "<subj> prefers/likes/uses/works in/etc. X
// (over Y)?" shapes and convert to k:v. Anything that doesn't match
// falls back to prose for that single line — partial structuring is
// better than failing the whole batch.
//
// §0.1: package-clean. No host imports.
import type { FactKind, MnemoFact } from "../primitives/fact";

export interface CompactRenderOptions {
  /** Soft token budget. Default 200. Estimated via chars/4. */
  maxTokensApprox?: number;
  /** Output style. Default 'structured'. */
  format?: "structured" | "prose";
  /**
   * v1.1 #13 — virtual line numbering. When `true`, each line that
   * corresponds to a fact with a non-null `drawerLine` is annotated with
   * a `(#N)` marker after the subject. Callers use this for prompt-time
   * citations ("as stated in fact #3 about Alice…").
   *
   *   Prose:      `[kind] subject (#3): statement`
   *   Structured: `[kind] (#2,#5) k:v, k:v`  (when all kvs have a line)
   *
   * Default `false` — annotation is off to preserve backward-compatible
   * output for callers that don't need citation markers.
   */
  showDrawerLine?: boolean;
}

interface KvPair {
  key: string;
  value: string;
}

// Chars-per-token heuristic. 4 is the cookbook number for English; for
// Spanish (the user's locale) it skews ~3.6 but 4 is a safe upper bound
// for token budgeting (rounding down = more conservative = fewer tokens).
const CHARS_PER_TOKEN = 4;

/** Estimate token count from chars; used for the soft cap only. */
function estTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

// ---- Pattern extractors ---------------------------------------------------

/**
 * "prefers X over Y" / "likes X more than Y" / "uses X instead of Y"
 * → { key: "X", value: "X>Y" }  — but for compactness we collapse:
 *   "lang:TS>Py" rather than "X:X>Y". Caller picks the key (we pass
 *   the matched X verbatim, lowercased + truncated).
 */
const PREF_OVER_RE =
  /(?:prefers?|likes?|uses?|chooses?|picks?|favou?rs?)\s+([A-Za-z][\w./+#-]*)\s+(?:over|instead of|more than|rather than)\s+([A-Za-z][\w./+#-]*)/i;

/**
 * "prefers X" / "uses X" / "likes X" (no comparison)
 */
const PREF_SINGLE_RE =
  /(?:prefers?|likes?|uses?|chooses?|picks?|favou?rs?)\s+([A-Za-z][\w./+#-]*(?:\s+[A-Za-z][\w./+#-]*){0,2})/i;

/**
 * "based in X" / "located in X" / "lives in X"
 */
const LOCATION_RE =
  /\b(?:based|located|lives?|works?|residing)\s+in\s+([A-Za-z][\w./ ,'-]+?)(?:\s+(?:and|with|but|in|on)|[.,;]|$)/i;

/**
 * "speaks X" / "language X" / "locale X"
 */
const LANG_RE =
  /\b(?:speaks?|language(?:s)?(?:\s+is)?|locale(?:\s+is)?)\s+([A-Za-z][\w./_-]{0,12})/i;

/**
 * "X timezone" / "in X timezone" / "X tz"
 */
const TZ_RE =
  /\b((?:UTC|GMT|EST|PST|CST|MST|EDT|PDT|CET|CEST|JST|IST|AEST|BRT|ART)(?:[+-]\d{1,2})?|[A-Z][a-z]+\/[A-Z][\w_]+)\b/;

/**
 * ISO-ish date "2026-03" / "2026-03-15"
 */
const DATE_RE = /\b(\d{4}-\d{2}(?:-\d{2})?)\b/;

/**
 * "decided X" / "chose X" / "decision: X"
 */
const DECISION_RE =
  /(?:decided(?:\s+to\s+use)?|chose|selected|picked|going\s+with|switched\s+to)\s+([A-Za-z][\w./+#-]*(?:\s+[A-Za-z][\w./+#-]*){0,2})/i;

// ---- kind-specific extractors --------------------------------------------

function extractPreference(fact: MnemoFact): KvPair | null {
  const s = fact.statement;
  const subj = fact.subject.toLowerCase();

  // Try "X over Y" pattern first — most informative.
  const m1 = s.match(PREF_OVER_RE);
  if (m1) {
    const x = m1[1]!.toLowerCase();
    const y = m1[2]!.toLowerCase();
    return { key: keyForPref(x, subj), value: `${x}>${y}` };
  }

  const m2 = s.match(PREF_SINGLE_RE);
  if (m2) {
    const x = m2[1]!.toLowerCase().trim();
    return { key: keyForPref(x, subj), value: x };
  }

  return null;
}

/** Guess a short k from the value (heuristic — keeps output stable). */
function keyForPref(value: string, _subj: string): string {
  const v = value.toLowerCase();
  if (/typescript|javascript|python|rust|go|java|swift|kotlin|c\+\+|c#|ruby|php/i.test(v))
    return "lang";
  if (/postgres|mysql|sqlite|mongodb|redis|cassandra|dynamodb|cockroach/i.test(v)) return "db";
  if (/vim|emacs|vscode|cursor|sublime|jetbrains/i.test(v)) return "editor";
  if (/aws|gcp|azure|vercel|cloudflare|fly\.io|netlify/i.test(v)) return "cloud";
  if (/react|vue|svelte|angular|solid|next|nuxt|remix/i.test(v)) return "fw";
  if (/espresso|coffee|tea|latte|cappuccino|mate/i.test(v)) return "drink";
  return "pref";
}

function extractTrait(fact: MnemoFact): KvPair[] {
  const s = fact.statement;
  const out: KvPair[] = [];

  const loc = s.match(LOCATION_RE);
  if (loc) {
    // Normalise "Buenos Aires" → "AR/BA" style if recognisable.
    const v = loc[1]!.trim();
    out.push({ key: "loc", value: shortenLocation(v) });
  }

  const lang = s.match(LANG_RE);
  if (lang) out.push({ key: "locale", value: lang[1]!.trim() });

  const tz = s.match(TZ_RE);
  if (tz) out.push({ key: "tz", value: tz[1]!.trim() });

  return out;
}

function shortenLocation(loc: string): string {
  const l = loc.toLowerCase();
  if (/buenos aires|capital federal/i.test(l)) return "AR/BA";
  if (/san francisco|sf bay/i.test(l)) return "US/SF";
  if (/new york|nyc/i.test(l)) return "US/NY";
  if (/london/i.test(l)) return "UK/LDN";
  // Default: just compact whitespace and truncate.
  return loc.replace(/\s+/g, " ").trim().slice(0, 24);
}

function extractEvent(fact: MnemoFact): KvPair | null {
  const s = fact.statement;
  const date = s.match(DATE_RE);
  if (!date) return null;
  // Pull the noun phrase preceding the date as the event key.
  const before = s.slice(0, date.index ?? 0).trim();
  const phrase = before.split(/[.,;]\s*/).pop() ?? before;
  const key = phrase
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\b(is|was|will be|scheduled for|planned for|on|at|in)\s+/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return { key: key || "event", value: date[1]! };
}

function extractDecision(fact: MnemoFact): KvPair | null {
  const s = fact.statement;
  const m = s.match(DECISION_RE);
  if (m) {
    const value = m[1]!.trim().toLowerCase();
    return { key: "choice", value };
  }
  return null;
}

// ---- top-level render ----------------------------------------------------

/**
 * Render a list of facts into a compact, token-budgeted block ready to
 * be injected into a system prompt. Returns "" when the input is empty.
 */
export function renderFactsCompact(facts: MnemoFact[], opts: CompactRenderOptions = {}): string {
  if (facts.length === 0) return "";
  const format = opts.format ?? "structured";
  const budget = opts.maxTokensApprox ?? 200;
  const showDrawerLine = opts.showDrawerLine ?? false;

  if (format === "prose") return renderProse(facts, budget, showDrawerLine);
  return renderStructured(facts, budget, showDrawerLine);
}

function renderProse(facts: MnemoFact[], budget: number, showDrawerLine?: boolean): string {
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const f of facts) {
    // v1.1 #13 — append `(#N)` after subject when the fact has a drawer
    // line and the caller opted into line-number annotations.
    const lineMarker = showDrawerLine && f.drawerLine != null ? ` (#${f.drawerLine})` : "";
    const line = `[${f.kind}] ${f.subject}${lineMarker}: ${f.statement}`;
    const cost = estTokens(line) + 1; // +1 for newline
    if (used + cost > budget && lines.length > 0) {
      dropped = facts.length - lines.length;
      break;
    }
    lines.push(line);
    used += cost;
  }
  if (dropped > 0) lines.push(`(+${dropped} more)`);
  return lines.join("\n");
}

function renderStructured(facts: MnemoFact[], budget: number, showDrawerLine?: boolean): string {
  // 1. Group by kind, preserving the input order within each group.
  const groups = new Map<FactKind, MnemoFact[]>();
  for (const f of facts) {
    const g = groups.get(f.kind) ?? [];
    g.push(f);
    groups.set(f.kind, g);
  }

  // 2. For each group, attempt to extract k:v pairs; otherwise emit a
  //    one-line prose fallback for that fact only.
  const lines: string[] = [];
  let used = 0;
  let stopped = false;

  for (const [kind, kindFacts] of groups) {
    if (stopped) break;
    const kvs: KvPair[] = [];
    const fallbacks: string[] = [];
    const seen = new Set<string>();
    // v1.1 #13 — collect drawer line numbers for facts that produced kvs
    // so we can emit a compact "#2,#5" prefix on the group line.
    const kvLineNums: number[] = [];

    for (const f of kindFacts) {
      const pairs = extractForKind(kind, f);
      if (pairs.length > 0) {
        for (const p of pairs) {
          const sig = `${p.key}=${p.value}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          kvs.push(p);
        }
        if (showDrawerLine && f.drawerLine != null) {
          kvLineNums.push(f.drawerLine);
        }
      } else {
        // v1.1 #13 — prose fallback for this fact: include (#N) if available.
        const lineMarker = showDrawerLine && f.drawerLine != null ? ` (#${f.drawerLine})` : "";
        fallbacks.push(`[${kind}] ${f.subject}${lineMarker}: ${f.statement}`);
      }
    }

    if (kvs.length > 0) {
      // v1.1 #13 — prepend "(#N,...)" before the k:v pairs when caller
      // opted into line-number annotations and at least one fact has a
      // drawer line. Kept to the first 3 to avoid a prefix longer than
      // the facts themselves.
      const linePrefix =
        showDrawerLine && kvLineNums.length > 0
          ? `(${kvLineNums
              .slice(0, 3)
              .map((n) => `#${n}`)
              .join(",")}) `
          : "";
      const line = `[${kind}] ${linePrefix}${kvs.map((p) => `${p.key}:${p.value}`).join(", ")}`;
      const cost = estTokens(line) + 1;
      if (used + cost > budget && lines.length > 0) {
        stopped = true;
        break;
      }
      lines.push(line);
      used += cost;
    }

    for (const fb of fallbacks) {
      const cost = estTokens(fb) + 1;
      if (used + cost > budget && lines.length > 0) {
        stopped = true;
        break;
      }
      lines.push(fb);
      used += cost;
    }
  }

  if (stopped) {
    // Count how many input facts didn't get into the output.
    const emittedCount = countEmittedFacts(facts, lines);
    const remaining = facts.length - emittedCount;
    if (remaining > 0) lines.push(`(+${remaining} more)`);
  }

  return lines.join("\n");
}

function extractForKind(kind: FactKind, fact: MnemoFact): KvPair[] {
  switch (kind) {
    case "preference":
    case "skill": {
      const p = extractPreference(fact);
      return p ? [p] : [];
    }
    case "trait":
      return extractTrait(fact);
    case "event": {
      const p = extractEvent(fact);
      return p ? [p] : [];
    }
    case "concern":
    case "relationship":
      // No specialised extractor — let it fall back to prose.
      return [];
    case "other": {
      // "other" facts often carry decision-like language ("decided to use
      // X", "chose Y") — try the decision extractor before prose fallback.
      const d = extractDecision(fact);
      return d ? [d] : [];
    }
    default: {
      // Future-proofing: any new FactKind values fall back to prose.
      // (Decisions are stored in a separate primitive, not mnemo_fact.)
      const _exhaustive: never = kind;
      void _exhaustive;
      return [];
    }
  }
}

/**
 * Best-effort count of how many input facts the emitted lines covered.
 * Used only for the "(+N more)" suffix — not exact in the structured
 * case because one line can summarise multiple facts.
 */
function countEmittedFacts(facts: MnemoFact[], lines: string[]): number {
  // Each prose-fallback line covers exactly one fact.
  let count = 0;
  for (const l of lines) {
    if (/^\[[a-z]+\]\s+[^:]+:\s/.test(l) && !/,/.test(l.split("] ")[1] ?? "")) {
      count++;
    }
  }
  // Each structured line covers ≥1 facts — we use the group size as a
  // floor (we can't know exactly without re-running extraction).
  const remaining = lines.length - count;
  return Math.min(
    facts.length,
    count + remaining * Math.max(1, Math.floor(facts.length / Math.max(1, lines.length)))
  );
}
