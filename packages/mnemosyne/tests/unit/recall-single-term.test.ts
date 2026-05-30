// v1.1 — #4: single-term query dampener.
//
// Unit tests for the `isSingleTermQuery` predicate. The dampening
// multiplier (0.6) is exercised by the integration test in
// tests/integration/recall-dampener.spec.ts; here we lock in the
// boundary semantics of the predicate itself so a future refactor
// doesn't silently shift what counts as "single term".
import { describe, it, expect } from "vitest";
import { isSingleTermQuery } from "../../src/recall/search";

describe("recall/search — isSingleTermQuery (#4)", () => {
  it("flags a bare content word as single-term", () => {
    expect(isSingleTermQuery("auth")).toBe(true);
    expect(isSingleTermQuery("user")).toBe(true);
    // Whitespace padding is irrelevant — trimmed before splitting.
    expect(isSingleTermQuery("  auth  ")).toBe(true);
  });

  it("does NOT flag multi-content-word queries", () => {
    expect(isSingleTermQuery("user data")).toBe(false);
    expect(isSingleTermQuery("foo bar")).toBe(false);
    expect(isSingleTermQuery("auth flow design")).toBe(false);
  });

  it("does NOT flag queries whose only word is too short (<= 2 chars)", () => {
    // Roadmap doesn't spell this out; documented choice: zero content
    // words means we can't claim "single concept", so no dampening. A
    // 2-char query like "ok" is too ambiguous to confidently dampen
    // OR to confidently amplify.
    expect(isSingleTermQuery("x")).toBe(false);
    expect(isSingleTermQuery("ok")).toBe(false);
    expect(isSingleTermQuery("a")).toBe(false);
  });

  it("does NOT flag a query of only stopword-sized tokens", () => {
    // `"x y"` → both <=2 chars → 0 content words → NOT single-term.
    expect(isSingleTermQuery("x y")).toBe(false);
    expect(isSingleTermQuery("a b c")).toBe(false);
  });

  it("does NOT flag an empty / whitespace-only query", () => {
    expect(isSingleTermQuery("")).toBe(false);
    expect(isSingleTermQuery("   ")).toBe(false);
    expect(isSingleTermQuery("\n\t")).toBe(false);
  });

  it("ignores short stopwords when counting content words", () => {
    // `"is auth ok"` → only "auth" survives the >2 filter → single-term.
    // This is the desired behaviour: the user's intent IS "auth", the
    // wrapper words add no specificity.
    expect(isSingleTermQuery("is auth ok")).toBe(true);
    // `"to the auth"` → only "the" and "auth" survive ("to" is 2 chars,
    // dropped). Two content words → NOT single-term.
    expect(isSingleTermQuery("to the auth")).toBe(false);
  });
});
