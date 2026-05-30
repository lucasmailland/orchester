// packages/mnemosyne/tests/unit/pointer-index.test.ts
//
// Unit tests for the v1.1 #1+2 pointer index tokenizer.
// No DB required — pure function only.

import { describe, it, expect } from "vitest";
import { extractPointerTerms } from "../../src/index/pointer";

describe("extractPointerTerms — tokenizer", () => {
  it("returns lowercase alphanum tokens", () => {
    const terms = extractPointerTerms("TypeScript React hooks");
    expect(terms).toContain("typescript");
    expect(terms).toContain("react");
    expect(terms).toContain("hooks");
  });

  it("excludes POINTER_STOPWORDS", () => {
    const terms = extractPointerTerms("the quick brown fox is running");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("is");
    // content words survive
    expect(terms).toContain("quick");
    expect(terms).toContain("brown");
    expect(terms).toContain("running");
  });

  it("excludes tokens shorter than MIN_TERM_LEN (3 chars)", () => {
    const terms = extractPointerTerms("I use Go to build APIs and REST endpoints");
    expect(terms).not.toContain("go"); // 2 chars
    expect(terms).not.toContain("to"); // 2 chars, also stopword
    expect(terms).toContain("apis");
    expect(terms).toContain("rest");
    expect(terms).toContain("endpoints");
  });

  it("deduplicates repeated tokens", () => {
    const terms = extractPointerTerms("auth auth authentication auth");
    // "auth" (4 chars, not a stopword) appears 3× in input → exactly 1 in output
    expect(terms.filter((t) => t === "auth").length).toBe(1);
    // "authentication" is also present — 1 occurrence
    expect(terms.filter((t) => t === "authentication").length).toBe(1);
    // No duplicates anywhere in the result
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("handles empty and whitespace-only input", () => {
    expect(extractPointerTerms("")).toEqual([]);
    expect(extractPointerTerms("   ")).toEqual([]);
  });

  it("handles input with only stopwords", () => {
    // All stopwords
    const terms = extractPointerTerms("the is are were be been");
    expect(terms).toEqual([]);
  });

  it("caps output at MAX_TERMS (50) for very long statements", () => {
    // Generate a 100-word unique statement
    const words = Array.from({ length: 100 }, (_, i) => `uniqueword${i}`);
    const terms = extractPointerTerms(words.join(" "));
    expect(terms.length).toBeLessThanOrEqual(50);
  });

  it("extracts terms from a realistic fact statement", () => {
    const statement =
      "Lucas Mailland prefers TypeScript over JavaScript for backend services at Orchester";
    const terms = extractPointerTerms(statement);
    expect(terms).toContain("lucas");
    expect(terms).toContain("mailland");
    expect(terms).toContain("prefers"); // "prefers" is not in POINTER_STOPWORDS
    expect(terms).toContain("typescript");
    expect(terms).toContain("javascript");
    expect(terms).toContain("backend");
    expect(terms).toContain("services");
    expect(terms).toContain("orchester");
    // stopwords excluded
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("for");
    expect(terms).not.toContain("at"); // "at" IS in POINTER_STOPWORDS
  });

  it("treats alphanumeric tokens (e.g. camelCase split by non-alpha) correctly", () => {
    const terms = extractPointerTerms("user_id=123 authToken=abc123def");
    // Non-alpha chars split the string: "user", "id", "123", "authtoken", "abc123def"
    expect(terms).toContain("user");
    expect(terms).toContain("authtoken");
    expect(terms).toContain("abc123def");
  });

  it("produces the same terms as a second call with the same input", () => {
    const text = "machine learning model training inference pipeline";
    expect(extractPointerTerms(text)).toEqual(extractPointerTerms(text));
  });

  it("all returned terms are lowercase", () => {
    const terms = extractPointerTerms("TypeScript REACT NextJs API Router");
    for (const t of terms) {
      expect(t).toBe(t.toLowerCase());
    }
  });

  it("does not include very common single-letter tokens (min length = 3)", () => {
    const terms = extractPointerTerms("A B C 1 2 I go do");
    // Single-char and two-char tokens excluded
    for (const t of terms) {
      expect(t.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("extractPointerTerms — pointer query alignment", () => {
  it("statement terms overlap with query terms for matching content", () => {
    // The pointer lookup requires that query terms match index terms.
    // Same tokenizer on both sides guarantees this.
    const statementTerms = new Set(
      extractPointerTerms("Lucas prefers dark mode and TypeScript strict configuration")
    );
    const queryTerms = extractPointerTerms("dark mode TypeScript preferences");
    const overlap = queryTerms.filter((t) => statementTerms.has(t));
    // "dark", "mode", "typescript" should all overlap
    expect(overlap.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty for a pure-stopword query (no routing possible)", () => {
    const terms = extractPointerTerms("what is the and or but");
    expect(terms).toEqual([]);
  });
});
