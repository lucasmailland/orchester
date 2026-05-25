// packages/mnemosyne/src/recall/triggering.ts
//
// Layer 2 trigger classifier for the v1.1 tiered memory injection.
// Pure heuristics — NO LLM call, NO Postgres round-trip. Must run in
// microseconds because it gates EVERY agent turn.
//
// The goal is to skip recall on the ~50% of turns that don't need it
// ("ok", "thanks", "5", "👍") while erring on the side of triggering
// when the turn looks like it might reference past context. Recall is
// cheap once Layer 1 (the distilled profile) already injected the
// must-know facts; Layer 2 is for deeper context.
//
// Returns a structured decision so the host can log / observe the
// classifier (helpful when tuning trigger rates per workspace).
//
// §0.1: package-clean.

export interface ShouldTriggerRecallInput {
  userTurn: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Below this length the turn is treated as a no-op. Default 15. */
  minTurnLength?: number;
}

export interface TriggerDecision {
  trigger: boolean;
  /** Short rule label that fired: "greeting" / "reference" / "pronoun" / etc. */
  reason: string;
  /** 0..1 — confidence the trigger / skip decision was correct. */
  confidence: number;
}

// ── Skip patterns ───────────────────────────────────────────────────────

/** Greetings, closings, ack-only turns. Case-insensitive, word-boundary. */
const SKIP_GREETING_RE =
  /^\s*(hi|hello|hey|yo|sup|ok+|okay|thanks|thank you|gracias|si|sí|no|nope|yep|yes|dale|listo|claro|chau|chao|adios|adiós|bye|cya|good night|good morning|buen día|buen dia|👍|🙏)[\s.,!?¡¿]*$/i;

/** Pure punctuation or emoji-only. */
const SKIP_PUNCT_RE = /^\s*[\s\p{P}\p{S}\p{Emoji}]+\s*$/u;

/** Pure number ("5", "10:30am", "$50.00"). */
const SKIP_NUMBER_RE = /^\s*[$€£¥]?\s*\d+(?:[.,:]\d+)*\s*(?:am|pm|h|hs|usd|eur|ars|%|\$)?\s*$/i;

// ── Trigger patterns ────────────────────────────────────────────────────

/**
 * Explicit reference words — strongest signal. The user is asking
 * about something we've discussed before.
 */
const TRIGGER_REFERENCE_RE =
  /\b(antes|previously|last time|recordá|recorda|recordas|recordás|recuerdas|sabés|sabes|yesterday|when we|que dije|que dijimos|nuestro|nuestra|like before|como antes|recall|remember|the one we|earlier|prior|que habíamos|que habiamos|hablamos|charlamos|discutimos|decidimos|talked about|said before|decided that)\b/i;

/**
 * Pronouns that imply a referent we need history to resolve.
 * Only counts when there's enough history to actually need resolution.
 */
const TRIGGER_PRONOUN_RE =
  /\b(él|ella|ellos|ellas|eso|esa|aquello|aquel|esos|esas|esto|esta|that|those|these|it|they|them|him|her|his|hers|its|their|theirs)\b/i;

const PRONOUN_MIN_HISTORY = 5;

/**
 * Question-form referring to past dialogue. Catches "what did we
 * decide?" / "when did we talk about X?".
 */
const TRIGGER_PAST_QUESTION_RE =
  /^\s*(qué|que|cuándo|cuando|cómo|como|por qué|porque|por que|what|when|where|why|how|which|who)\b[^.?!]*\b(dijimos|dije|dijiste|hablamos|habló|hablo|hablaste|charlamos|decidimos|decidiste|decidí|decidi|discutimos|discutiste|discutí|discuti|mencioné|mencione|mencionaste|talked|said|decided|discussed|mentioned|told)\b/i;

/**
 * Detect ProperCapitalized words ("Acme", "Lucas", "Postgres"). When
 * we see more than one we assume the user is referring to named
 * entities and recall is probably worth it. We exclude the very first
 * word of the turn (often capitalized by autocorrect / sentence start)
 * to avoid false positives on "What's up?".
 */
function countProperNouns(turn: string): number {
  // Drop leading punctuation/whitespace
  const trimmed = turn.replace(/^[\s\p{P}]+/u, "");
  if (trimmed.length === 0) return 0;

  // Strip the first token so a sentence-initial capital doesn't count.
  const firstWordEnd = trimmed.search(/\s/);
  const rest = firstWordEnd === -1 ? "" : trimmed.slice(firstWordEnd + 1);

  // Match capitalized words that aren't ALL-CAPS acronyms shorter than 2.
  // Allow accented uppercase (Á, É, Ñ, etc.).
  const matches = rest.match(/\b[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü][a-záéíóúñü0-9_-]{1,}\b/g);
  return matches ? matches.length : 0;
}

/**
 * Compute the classification. Pure function — same input → same output.
 * Designed to be called on every turn before recall.
 */
export function shouldTriggerRecall(input: ShouldTriggerRecallInput): TriggerDecision {
  const turn = (input.userTurn ?? "").trim();
  const minLen = input.minTurnLength ?? 15;
  const historyLen = input.history?.length ?? 0;

  // ── Hard SKIP rules (cheap turn → no recall) ──────────────────────
  if (turn.length === 0) {
    return { trigger: false, reason: "empty", confidence: 1.0 };
  }
  if (SKIP_PUNCT_RE.test(turn)) {
    return { trigger: false, reason: "punctuation_only", confidence: 0.95 };
  }
  if (SKIP_NUMBER_RE.test(turn)) {
    return { trigger: false, reason: "number_only", confidence: 0.9 };
  }
  if (SKIP_GREETING_RE.test(turn)) {
    return { trigger: false, reason: "greeting", confidence: 0.95 };
  }
  if (turn.length < minLen) {
    return { trigger: false, reason: "too_short", confidence: 0.7 };
  }

  // ── Hard TRIGGER rules (strong signal — definitely needs recall) ─
  if (TRIGGER_REFERENCE_RE.test(turn)) {
    return { trigger: true, reason: "reference_word", confidence: 0.95 };
  }
  if (TRIGGER_PAST_QUESTION_RE.test(turn)) {
    return { trigger: true, reason: "past_question", confidence: 0.9 };
  }
  if (historyLen >= PRONOUN_MIN_HISTORY && TRIGGER_PRONOUN_RE.test(turn)) {
    return { trigger: true, reason: "pronoun_with_history", confidence: 0.7 };
  }
  if (countProperNouns(turn) > 1) {
    return { trigger: true, reason: "named_entities", confidence: 0.7 };
  }

  // ── Default: trigger ────────────────────────────────────────────
  // When in doubt, recall — recall is cheap and Layer 1 already
  // covered the must-know context, so a missed Layer 2 hit is the
  // costlier failure mode.
  return { trigger: true, reason: "default", confidence: 0.5 };
}
