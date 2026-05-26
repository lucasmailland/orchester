// packages/mnemosyne/src/entity/extract.ts
//
// Mnemosyne v1.6 — heuristic-first entity extraction from text, with
// optional LLM-assisted classification.
//
// The extraction pipeline (`apps/web/lib/brain/extract-job.ts`) calls
// this once per slice. It returns a list of EntityCandidate values;
// the caller passes each through `findOrCreate` (in `./store.ts`) to
// dedupe against existing entities in the workspace.
//
// Two-pass design:
//   1. Heuristic scan — regex patterns for common shapes (@handle,
//      "Two Capitalized Words", "Acme Inc.", "Q2 2026", projects ending
//      in "Launch"/"Initiative"). Cheap, deterministic, runs on every
//      slice. Default `kind` per pattern (handle -> person, suffix
//      Inc. -> organization, ...).
//   2. LLM-assisted classification — optional. When the caller passes
//      `llm`, we send the heuristic candidates to a cheap-tier model
//      and let it correct/refine the `kind` field. Spend cap +
//      metering live in the CALLER (extract-job.ts) per the audit
//      invariant — this module is package-clean.
//
// §0.1: package-clean — no `server-only`, no host imports.
import type { EntityKind } from "./store";

/**
 * Host-injected LLM call function for the entity-classification pass.
 *
 * Differs from the `LlmCallFn` exported by `../recall/query-prep` —
 * that one is a thin paraphrase/HyDE hop with `{prompt, maxTokens}`.
 * The entity classification needs the heavier shape (system + messages
 * + temperature) so the model can be steered toward JSON-only output.
 *
 * Named `EntityLlmCallFn` to avoid clashing with the recall-side
 * `LlmCallFn`. The host adapter (`extract-job.ts`) passes the same
 * `llmCall` reference for both — the shape happens to be a strict
 * superset on the relevant fields.
 *
 * The function is OPTIONAL on `extractEntities` — when absent we
 * return heuristic-only candidates. The caller MUST pair every call
 * site with `assertWithinSpend` + `recordAiUsage` (audit invariant
 * enforced by `scripts/audit-invariants.sh`).
 */
export type EntityLlmCallFn = (params: {
  workspaceId: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ content: string | null; tokensUsed?: number; model: string }>;

/**
 * One candidate surfaced by the extractor. The caller (extract-job.ts)
 * persists via `findOrCreate(workspaceId, name, kind, aliases)`. The
 * `positions` array carries character offsets for downstream UI
 * highlighting (the inspector renders the source slice with entity
 * mentions tinted).
 */
export interface EntityCandidate {
  name: string;
  kind: EntityKind;
  aliases: string[];
  /** Character offsets in the source text. Empty when the heuristic
   *  matched but offsets weren't tracked (LLM-only pass). */
  positions: Array<{ start: number; end: number }>;
}

export interface ExtractEntitiesInput {
  text: string;
  /** Optional LLM call function for the classification pass. When
   *  absent we return heuristic-only candidates. The caller is
   *  responsible for `assertWithinSpend` + `recordAiUsage` around any
   *  LLM calls — this file stays package-clean. */
  llm?: EntityLlmCallFn;
  /** Model identifier required when `llm` is provided. */
  model?: string;
  workspaceId: string;
}

// Heuristic patterns: each is a (regex, kind) pair. Materialise matches
// in order so an earlier pattern wins on ambiguity (e.g. "@lucas" is a
// person before it ever competes with "Lucas Mailland"'s
// Two-Capitalized-Words pattern).

/** @-prefixed handle. Maps to person by default. */
const HANDLE_RE = /@[a-z][a-z0-9_-]*/gi;

/** "Acme Inc." / "Acme Corp." / "Acme Co." / "Acme LLC" / "Acme Ltd." / "Acme GmbH" */
const ORG_RE =
  /\b[A-Z][a-zA-Z0-9&-]*(?:\s+[A-Z][a-zA-Z0-9&-]*)*\s+(?:Inc\.|Corp\.|Co\.|LLC|Ltd\.|GmbH|S\.A\.|S\.R\.L\.)/g;

/** Quarter notation: "Q1 2026", "Q2 2026", "2026-Q2", "2026/Q2". */
const QUARTER_RE = /\b(?:Q[1-4]\s+\d{4}|\d{4}[-/]Q[1-4])\b/g;

/** Project-ish phrase ending in a project word. */
const PROJECT_RE =
  /\b[A-Z][a-zA-Z0-9]*(?:\s+[A-Z]?[a-zA-Z0-9]*){0,3}\s+(?:Project|Launch|Initiative|Rollout|Migration)\b/g;

/** Two Capitalized Words. Last so it loses to handle/org/project on
 *  overlap. Matches "Lucas Mailland", "Buenos Aires" (also a place —
 *  heuristics are coarse on purpose, the LLM classification pass
 *  refines). */
const PERSON_RE = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g;

interface HeuristicHit {
  name: string;
  kind: EntityKind;
  start: number;
  end: number;
}

/**
 * Run all heuristic patterns over `text` and return non-overlapping
 * hits. Earlier patterns win on overlap so a span matched as @handle
 * (person) is NOT re-matched as Two-Capitalized-Words.
 *
 * O(n*k) where n = text length, k = pattern count. Trivial for
 * conversation-slice inputs (k = 5, n <= ~5000 chars).
 */
function heuristicScan(text: string): HeuristicHit[] {
  const hits: HeuristicHit[] = [];
  const claimed: Array<[number, number]> = [];

  function overlapsClaimed(start: number, end: number): boolean {
    for (const [cs, ce] of claimed) {
      if (start < ce && end > cs) return true;
    }
    return false;
  }

  function addMatches(re: RegExp, kind: EntityKind): void {
    // Reset lastIndex so a re-use of the same regex across calls
    // doesn't skip half the matches in `text`.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlapsClaimed(start, end)) continue;
      hits.push({ name: m[0].trim(), kind, start, end });
      claimed.push([start, end]);
    }
  }

  // Order matters: more specific patterns first so they win on overlap.
  addMatches(HANDLE_RE, "person");
  addMatches(ORG_RE, "organization");
  addMatches(QUARTER_RE, "concept");
  addMatches(PROJECT_RE, "project");
  addMatches(PERSON_RE, "person");

  return hits;
}

/**
 * Group hits by canonical name (case-insensitive), collapsing repeated
 * mentions into one candidate per unique entity. The resulting
 * candidate carries every position the heuristic saw + every spelling
 * as an alias (case-distinct spellings only — "Lucas" + "lucas" merge,
 * but "@lucas" + "Lucas Mailland" stay separate).
 */
function groupHits(hits: HeuristicHit[]): EntityCandidate[] {
  const groups = new Map<
    string,
    {
      name: string;
      kind: EntityKind;
      aliases: Set<string>;
      positions: Array<{ start: number; end: number }>;
    }
  >();

  for (const h of hits) {
    const key = `${h.kind}:${h.name.toLowerCase()}`;
    const group = groups.get(key);
    if (group) {
      group.aliases.add(h.name);
      group.positions.push({ start: h.start, end: h.end });
    } else {
      groups.set(key, {
        name: h.name,
        kind: h.kind,
        aliases: new Set<string>([h.name]),
        positions: [{ start: h.start, end: h.end }],
      });
    }
  }

  return Array.from(groups.values()).map((g) => ({
    name: g.name,
    kind: g.kind,
    // Materialise the Set as a deterministic-order array so test
    // assertions don't have to sort.
    aliases: Array.from(g.aliases).sort(),
    positions: g.positions,
  }));
}

/**
 * Ask the LLM to refine the `kind` classification of an existing list
 * of candidates. We do NOT ask it to extract new entities — that's the
 * heuristic's job. The prompt is intentionally narrow: "here are 5
 * names, classify each".
 *
 * Failure modes (network, parse, schema mismatch) silently fall back
 * to the heuristic kinds. Re-classification is a polish; losing it
 * doesn't break the pipeline.
 *
 * The caller MUST wrap the call site in `assertWithinSpend` +
 * `recordAiUsage` — this module is package-clean and can't reach the
 * spend cap / metering helpers (which live under apps/web/lib).
 */
async function classifyWithLlm(
  candidates: EntityCandidate[],
  llm: EntityLlmCallFn,
  model: string,
  workspaceId: string
): Promise<EntityCandidate[]> {
  if (candidates.length === 0) return [];

  // Compact JSON prompt — single LLM hop. We pass just the names so
  // the model isn't biased by the heuristic's guess (it could be
  // wrong, e.g. "Buenos Aires" classified as person should become
  // place). The cardinality cap (5) matches the extraction pipeline's
  // per-slice fact cap.
  const sample = candidates.slice(0, 5);
  const prompt = `Classify each of these strings as one of: person, organization, project, concept, place, other.
Output ONLY a JSON object mapping each string to its kind. No prose, no markdown.

Strings:
${sample.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}

Example output: {"Lucas Mailland":"person","Acme Inc.":"organization"}`;

  try {
    const result = await llm({
      workspaceId,
      model,
      systemPrompt: "You classify named entities. Output JSON only.",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      maxTokens: 200,
    });

    const raw = (result.content ?? "").trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as Record<string, string>;

    return candidates.map((c) => {
      const newKind = parsed[c.name];
      if (!newKind) return c;
      // Validate against the 6-value vocabulary; fall back to the
      // heuristic kind on unknown strings.
      if (
        newKind === "person" ||
        newKind === "organization" ||
        newKind === "project" ||
        newKind === "concept" ||
        newKind === "place" ||
        newKind === "other"
      ) {
        return { ...c, kind: newKind as EntityKind };
      }
      return c;
    });
  } catch {
    // Swallow — the heuristic kinds are still good enough to persist.
    // The caller is expected to log + record the LLM failure metering
    // upstream, so we don't log here (this module is package-clean
    // and has no shared logger).
    return candidates;
  }
}

/**
 * Extract entities from text. Heuristic-only when `llm` is absent;
 * heuristic + LLM-refined kinds when `llm` is supplied. Returns
 * candidates that the caller persists via `findOrCreate` (which
 * handles the workspace dedup).
 *
 * Idempotent: re-running on the same text returns the same candidates
 * (the heuristic scan is deterministic, the LLM pass is wrapped in a
 * try/catch that falls back on failure so a flaky model doesn't
 * change the heuristic output non-deterministically).
 */
export async function extractEntities(input: ExtractEntitiesInput): Promise<EntityCandidate[]> {
  if (!input.text || input.text.trim().length === 0) return [];

  const hits = heuristicScan(input.text);
  const candidates = groupHits(hits);

  if (input.llm && input.model && candidates.length > 0) {
    return classifyWithLlm(candidates, input.llm, input.model, input.workspaceId);
  }

  return candidates;
}
