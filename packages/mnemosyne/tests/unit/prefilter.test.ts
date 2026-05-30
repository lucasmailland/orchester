import { describe, it, expect } from "vitest";
import { shouldExtract, shouldExtractBackfill } from "../../src/extraction/prefilter";

describe("extraction/prefilter (A1)", () => {
  it("skips when total content is too short", () => {
    const r = shouldExtract([{ role: "user", content: "hi" }]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("too_short");
  });

  it("skips when all messages are short greetings", () => {
    const r = shouldExtract([
      { role: "user", content: "hi there" },
      { role: "assistant", content: "hello! how are you" },
      { role: "user", content: "great thanks" },
    ]);
    expect(r.yes).toBe(false);
  });

  it("accepts preference indicators", () => {
    const r = shouldExtract([
      {
        role: "user",
        content: "I really prefer responses in Spanish when we discuss billing topics please",
      },
    ]);
    expect(r.yes).toBe(true);
    expect(r.reason).toBe("indicator_match");
  });

  it("accepts decision indicators", () => {
    const r = shouldExtract([
      {
        role: "assistant",
        content: "We decided to use JWT instead of session cookies for the new auth flow",
      },
    ]);
    expect(r.yes).toBe(true);
  });

  it("accepts proper noun mentions", () => {
    const r = shouldExtract([
      {
        role: "user",
        content: "Daisy from Acme will be the main contact for this project moving forward okay",
      },
    ]);
    expect(r.yes).toBe(true);
  });

  it("rejects when no dialogue (only system/tool roles)", () => {
    const r = shouldExtract([
      {
        role: "system",
        content: "system instructions go here in a fairly long text block",
      },
      {
        role: "tool",
        content: "tool output result data structure with various keys and values",
      },
    ]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("no_dialogue");
  });
});

describe("extraction/prefilter backfill (v1.1 #20)", () => {
  it("accepts a turn that has no indicator but sufficient content", () => {
    // This turn passes shouldExtract's length/token checks but hits
    // `no_indicator` because none of the POSITIVE_INDICATORS regex
    // patterns match. shouldExtractBackfill must still accept it.
    //
    // Carefully chosen to avoid ALL indicator patterns:
    //   - no prefer/like/love/hate/need/want/always/never/usually
    //   - no decided/will/going to/plan to/chose/adopted
    //   - no at/in/from/works for/lives in/located
    //   - no "my (name|email|…)"
    //   - no ProperNoun ProperNoun pattern
    const msgs = [
      { role: "user" as const, content: "How many rows does the table currently hold?" },
      {
        role: "assistant" as const,
        content: "The table currently holds five hundred records, spread across three shards.",
      },
    ];
    expect(shouldExtract(msgs).yes).toBe(false); // strict: no_indicator
    const r = shouldExtractBackfill(msgs);
    expect(r.yes).toBe(true);
    expect(r.reason).toBe("backfill_no_indicator");
  });

  it("accepts a turn with an indicator (same as strict prefilter would)", () => {
    const msgs = [
      {
        role: "user" as const,
        content: "I prefer the dark theme always — it reduces eyestrain in the evening",
      },
    ];
    const r = shouldExtractBackfill(msgs);
    expect(r.yes).toBe(true);
    expect(r.reason).toBe("indicator_match");
  });

  it("rejects when total content is below the backfill floor (< 20 chars)", () => {
    const r = shouldExtractBackfill([{ role: "user", content: "ok" }]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("too_short");
  });

  it("rejects when no dialogue (only system/tool) — same hard gate as strict", () => {
    const r = shouldExtractBackfill([
      { role: "system", content: "system config block with many words for the extraction test" },
    ]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("no_dialogue");
  });

  it("rejects when content tokens are below the backfill floor (< 2)", () => {
    // All stopwords — no content tokens survive the stopword filter
    const r = shouldExtractBackfill([
      { role: "user", content: "ok yes sure thank you please" },
      { role: "assistant", content: "yes" },
    ]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("no_content_tokens");
  });

  it("backfill is strictly more permissive than strict prefilter", () => {
    // Any turn that passes shouldExtract must also pass shouldExtractBackfill.
    const goodTurn = [
      {
        role: "user" as const,
        content: "I like using TypeScript and prefer strict null checks always enabled",
      },
    ];
    expect(shouldExtract(goodTurn).yes).toBe(true);
    expect(shouldExtractBackfill(goodTurn).yes).toBe(true);
  });
});
