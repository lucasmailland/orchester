// packages/mnemosyne/tests/unit/auto-pin.test.ts
//
// Pure unit tests for the v1.3 auto-pin rule evaluator. No DB, no
// network — varies the input record across the rule matrix and
// asserts decisions + the metadata stamp shape.
import { describe, it, expect } from "vitest";
import { decideAutoPin, buildAutoPinStamp } from "../../src/review/auto-pin";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** Defaults that DON'T fire any rule. Each test mutates a single
 *  axis so the failure message reads naturally. */
function baseFact() {
  return {
    pinned: false,
    hitCount: 0,
    confidence: 0.7,
    kind: "other" as const,
    scope: "global" as const,
    ageMs: 0,
    metadata: {},
  };
}

describe("review/auto-pin — decideAutoPin", () => {
  it("no-match when nothing fires", () => {
    const d = decideAutoPin(baseFact());
    expect(d.shouldPin).toBe(false);
    expect(d.rule).toBeNull();
    expect(d.reason).toBe("no_match");
  });

  // ── Rule 1: hit_5_age_14d ────────────────────────────────────────
  it("fires hit_5_age_14d when hit_count=5 + age=14d", () => {
    const d = decideAutoPin({
      ...baseFact(),
      hitCount: 5,
      ageMs: FOURTEEN_DAYS_MS,
    });
    expect(d.shouldPin).toBe(true);
    expect(d.rule).toBe("hit_5_age_14d");
    expect(d.reason).toBe("rule_fired");
  });

  it("doesn't fire hit_5_age_14d when hit_count=4 (off-by-one)", () => {
    const d = decideAutoPin({
      ...baseFact(),
      hitCount: 4,
      ageMs: FOURTEEN_DAYS_MS,
    });
    expect(d.shouldPin).toBe(false);
  });

  it("doesn't fire hit_5_age_14d when age is 13d (off-by-one)", () => {
    const d = decideAutoPin({
      ...baseFact(),
      hitCount: 5,
      ageMs: FOURTEEN_DAYS_MS - 1,
    });
    expect(d.shouldPin).toBe(false);
  });

  it("fires hit_5_age_14d for hit_count well above 5", () => {
    const d = decideAutoPin({
      ...baseFact(),
      hitCount: 100,
      ageMs: 30 * 24 * 60 * 60 * 1000,
    });
    expect(d.rule).toBe("hit_5_age_14d");
  });

  // ── Rule 2: trait_pref_high_conf ─────────────────────────────────
  it("fires trait_pref_high_conf for kind=trait + scope=global + conf=0.85", () => {
    const d = decideAutoPin({
      ...baseFact(),
      kind: "trait",
      scope: "global",
      confidence: 0.85,
    });
    expect(d.shouldPin).toBe(true);
    expect(d.rule).toBe("trait_pref_high_conf");
  });

  it("fires trait_pref_high_conf for kind=preference + scope=global + conf=0.9", () => {
    const d = decideAutoPin({
      ...baseFact(),
      kind: "preference",
      scope: "global",
      confidence: 0.9,
    });
    expect(d.rule).toBe("trait_pref_high_conf");
  });

  it("doesn't fire trait_pref_high_conf at conf=0.84 (off-by-one)", () => {
    const d = decideAutoPin({
      ...baseFact(),
      kind: "trait",
      scope: "global",
      confidence: 0.84,
    });
    expect(d.shouldPin).toBe(false);
  });

  it("doesn't fire trait_pref_high_conf for scope=conversation", () => {
    const d = decideAutoPin({
      ...baseFact(),
      kind: "trait",
      scope: "conversation",
      confidence: 0.9,
    });
    expect(d.shouldPin).toBe(false);
  });

  it("doesn't fire trait_pref_high_conf for kind=skill (even with conf+scope)", () => {
    const d = decideAutoPin({
      ...baseFact(),
      kind: "skill",
      scope: "global",
      confidence: 0.95,
    });
    expect(d.shouldPin).toBe(false);
  });

  // ── Guard: already pinned ────────────────────────────────────────
  it("returns already_pinned when fact is already pinned (rule still matches)", () => {
    const d = decideAutoPin({
      ...baseFact(),
      pinned: true,
      hitCount: 100,
      ageMs: FOURTEEN_DAYS_MS,
    });
    expect(d.shouldPin).toBe(false);
    expect(d.reason).toBe("already_pinned");
    expect(d.rule).toBeNull();
  });

  // ── Guard: user override ────────────────────────────────────────
  it("respects auto_pinned_overridden=true even when rule fires", () => {
    const d = decideAutoPin({
      ...baseFact(),
      hitCount: 50,
      ageMs: FOURTEEN_DAYS_MS,
      metadata: { auto_pinned_overridden: true },
    });
    expect(d.shouldPin).toBe(false);
    expect(d.reason).toBe("user_overrode");
  });

  it("does NOT respect non-true override values (defensive truthiness)", () => {
    // Only the literal `true` should block — strings, 1, 'yes' must not.
    const d = decideAutoPin({
      ...baseFact(),
      hitCount: 5,
      ageMs: FOURTEEN_DAYS_MS,
      metadata: { auto_pinned_overridden: "true" }, // string, not bool
    });
    expect(d.shouldPin).toBe(true);
  });

  // ── Tie-breaker ─────────────────────────────────────────────────
  it("prefers hit_5_age_14d over trait_pref_high_conf when both match", () => {
    const d = decideAutoPin({
      ...baseFact(),
      hitCount: 5,
      ageMs: FOURTEEN_DAYS_MS,
      kind: "trait",
      scope: "global",
      confidence: 0.95,
    });
    expect(d.rule).toBe("hit_5_age_14d");
  });
});

describe("review/auto-pin — buildAutoPinStamp", () => {
  it("emits the expected metadata shape", () => {
    const at = new Date("2026-06-01T12:00:00.000Z");
    const stamp = buildAutoPinStamp("hit_5_age_14d", at);
    expect(stamp).toEqual({
      auto_pinned: {
        rule: "hit_5_age_14d",
        at: "2026-06-01T12:00:00.000Z",
      },
    });
  });

  it("preserves the second rule id", () => {
    const at = new Date("2026-06-01T12:00:00.000Z");
    const stamp = buildAutoPinStamp("trait_pref_high_conf", at);
    expect(stamp.auto_pinned.rule).toBe("trait_pref_high_conf");
  });
});
