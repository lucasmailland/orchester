// packages/mnemosyne/tests/unit/triggering.test.ts
//
// Unit tests for the Layer 2 trigger classifier. Pure function — no
// fixtures, no DB, no network. We exercise each branch (skip + trigger)
// plus the "default trigger when in doubt" fallback.
import { describe, it, expect } from "vitest";
import { shouldTriggerRecall } from "../../src/recall/triggering";

describe("recall/triggering — shouldTriggerRecall", () => {
  // ── SKIP cases ────────────────────────────────────────────────────────
  it("skips empty input", () => {
    const d = shouldTriggerRecall({ userTurn: "" });
    expect(d.trigger).toBe(false);
    expect(d.reason).toBe("empty");
  });

  it("skips punctuation-only turn", () => {
    const d = shouldTriggerRecall({ userTurn: "?!?" });
    expect(d.trigger).toBe(false);
    expect(d.reason).toBe("punctuation_only");
  });

  it("skips number-only turn", () => {
    const d = shouldTriggerRecall({ userTurn: "10:30am" });
    expect(d.trigger).toBe(false);
    expect(d.reason).toBe("number_only");
  });

  it("skips greeting 'ok'", () => {
    const d = shouldTriggerRecall({ userTurn: "ok" });
    expect(d.trigger).toBe(false);
    expect(d.reason).toBe("greeting");
  });

  it("skips Spanish ack 'dale'", () => {
    const d = shouldTriggerRecall({ userTurn: "dale" });
    expect(d.trigger).toBe(false);
    expect(d.reason).toBe("greeting");
  });

  it("skips greeting 'thanks'", () => {
    const d = shouldTriggerRecall({ userTurn: "thanks!" });
    expect(d.trigger).toBe(false);
    expect(d.reason).toBe("greeting");
  });

  it("skips a turn shorter than minTurnLength", () => {
    const d = shouldTriggerRecall({ userTurn: "hola" });
    // greeting takes precedence; pure short non-greeting test:
    const d2 = shouldTriggerRecall({ userTurn: "asdfg" });
    expect(d.trigger).toBe(false);
    expect(d2.trigger).toBe(false);
    expect(d2.reason).toBe("too_short");
  });

  // ── TRIGGER cases ─────────────────────────────────────────────────────
  it("triggers on explicit Spanish reference 'antes'", () => {
    const d = shouldTriggerRecall({ userTurn: "Como te dije antes, prefiero TS" });
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("reference_word");
    expect(d.confidence).toBeGreaterThan(0.8);
  });

  it("triggers on explicit English reference 'previously'", () => {
    const d = shouldTriggerRecall({
      userTurn: "We discussed this previously, what was the plan?",
    });
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("reference_word");
  });

  it("triggers on past-question form 'how did you discussed'", () => {
    // Past-question form: WH-word + past-tense verb from the regex.
    // 'discussed' is in the past-question list but NOT in the
    // reference_word list (which has 'discutimos'/'talked about'),
    // so this turn fires past_question, not reference_word.
    const d = shouldTriggerRecall({
      userTurn: "how did you discussed the caching plan?",
    });
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("past_question");
  });

  it("triggers on pronoun + sufficient history", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    const d = shouldTriggerRecall({
      userTurn: "ok and what about that other option?",
      history,
    });
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("pronoun_with_history");
  });

  it("does NOT trigger pronoun rule without enough history", () => {
    const d = shouldTriggerRecall({
      userTurn: "what about that other option?",
      history: [],
    });
    // Falls through to default (length >= 15, no other rule matched).
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("default");
  });

  it("triggers on multiple proper nouns", () => {
    const d = shouldTriggerRecall({
      userTurn: "Lucas mentioned Acme Postgres on Monday",
    });
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("named_entities");
  });

  it("falls back to 'default' for a generic substantive turn", () => {
    const d = shouldTriggerRecall({
      userTurn: "can you write me a short blog post about caching?",
    });
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("default");
    expect(d.confidence).toBeLessThan(0.6);
  });

  it("respects custom minTurnLength override", () => {
    // Default minLen=15 would skip "abcdef" (6 chars). With minLen=4
    // it falls through to default trigger.
    const d = shouldTriggerRecall({ userTurn: "abcdef", minTurnLength: 4 });
    expect(d.trigger).toBe(true);
    expect(d.reason).toBe("default");
  });
});
