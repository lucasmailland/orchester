// packages/mnemosyne/src/review/auto-pin.ts
//
// Mnemosyne v1.3 — auto-pin rule set.
//
// Pure-function rule evaluator the host worker
// (apps/web/worker/auto-pin-job.ts) uses to decide whether a fact
// deserves the pinned bit set. Two rules at v1.3:
//
//   Rule "hit_5_age_14d" — frequently-recalled mature fact
//     hit_count >= 5 AND age >= 14d AND NOT pinned
//   Rule "trait_pref_high_conf" — high-confidence workspace-level
//     identity bit
//     kind in {trait, preference} AND scope='workspace' AND
//     confidence >= 0.85 AND NOT pinned
//
// The worker pins the fact AND stamps `metadata.auto_pinned =
// { rule, at }` so the inspector UI can flag "this was auto-pinned"
// and the override path is observable. If a user then unpins, the
// worker stamps `metadata.auto_pinned_overridden = true` so the same
// rule doesn't re-pin on the next tick — the user's choice is sticky.
//
// §0.1: package-clean — no host imports, no DB, no `server-only`.
// Tested as a pure function in tests/unit/auto-pin.test.ts.

export type AutoPinRuleId = "hit_5_age_14d" | "trait_pref_high_conf";

export interface AutoPinFactInput {
  /** Whether the fact is currently pinned. */
  pinned: boolean;
  /** Recall count (0+). */
  hitCount: number;
  /** Confidence score (0..1). */
  confidence: number;
  /** Memory kind (matches the mnemo_fact enum). */
  kind: "preference" | "trait" | "event" | "relationship" | "skill" | "concern" | "other";
  /** Scope — only 'workspace'-equivalent ('global' in the v1 schema)
   *  participates in rule 2. The schema enum is
   *  {global, conversation, employee, team}; v1.3 maps 'global' to the
   *  brief's "workspace" concept. */
  scope: "global" | "conversation" | "employee" | "team";
  /** Fact age in milliseconds. Computed by the caller via
   *  `Date.now() - createdAt.getTime()` so we stay pure. */
  ageMs: number;
  /** Existing metadata bag. Used to detect a prior user override. */
  metadata: Record<string, unknown>;
}

export interface AutoPinDecision {
  /** True iff at least one rule fires AND no override blocks it. */
  shouldPin: boolean;
  /** Which rule fired (the FIRST matching one in evaluation order).
   *  Null when `shouldPin` is false. */
  rule: AutoPinRuleId | null;
  /** Why the decision is what it is. Useful for log lines. */
  reason: "no_match" | "already_pinned" | "user_overrode" | "rule_fired";
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const HIT_THRESHOLD = 5;
const CONF_THRESHOLD = 0.85;

/**
 * Decide whether the worker should auto-pin this fact. Pure — no
 * I/O, no Date.now() — so it's trivial to unit-test by varying the
 * input record.
 *
 * Rule evaluation order: rule 1 ("hit_5_age_14d") wins ties because
 * it's a stronger signal (the agent has actively recalled this fact
 * five times in real conversations vs. a static confidence
 * threshold). The order affects only the recorded `rule` id — the
 * pin bit is the same either way.
 */
export function decideAutoPin(input: AutoPinFactInput): AutoPinDecision {
  // Override guard. If the user has manually unpinned the fact after
  // it was auto-pinned by a rule, the worker records
  // `metadata.auto_pinned_overridden = true`. The next tick must
  // skip this row entirely so we don't pin-fight the user.
  if (input.metadata["auto_pinned_overridden"] === true) {
    return { shouldPin: false, rule: null, reason: "user_overrode" };
  }
  if (input.pinned) {
    return { shouldPin: false, rule: null, reason: "already_pinned" };
  }

  // Rule 1 — recall-based mature fact.
  if (input.hitCount >= HIT_THRESHOLD && input.ageMs >= FOURTEEN_DAYS_MS) {
    return { shouldPin: true, rule: "hit_5_age_14d", reason: "rule_fired" };
  }

  // Rule 2 — high-confidence workspace-level identity.
  // The brief's "workspace" scope maps to 'global' in the v1 schema —
  // it's the scope that applies to the whole workspace and isn't
  // tied to a conversation / employee / team subject.
  if (
    (input.kind === "trait" || input.kind === "preference") &&
    input.scope === "global" &&
    input.confidence >= CONF_THRESHOLD
  ) {
    return { shouldPin: true, rule: "trait_pref_high_conf", reason: "rule_fired" };
  }

  return { shouldPin: false, rule: null, reason: "no_match" };
}

/**
 * Build the `auto_pinned` metadata stamp that the worker merges into
 * `metadata` when it pins a fact via this rule. The stamp lets the
 * UI render "this was auto-pinned by rule X on date Y" and the user
 * can act on it. ISO 8601 timestamp for cross-system parsability.
 */
export function buildAutoPinStamp(
  rule: AutoPinRuleId,
  at: Date
): { auto_pinned: { rule: AutoPinRuleId; at: string } } {
  return {
    auto_pinned: {
      rule,
      at: at.toISOString(),
    },
  };
}
