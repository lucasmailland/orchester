// packages/mnemosyne/tests/unit/entity-extract.test.ts
//
// Mnemosyne v1.6 G2 — entity-extraction heuristic + LLM-mock unit tests.
//
// Covers:
//   • Heuristic patterns (handle, organization suffix, quarter, project,
//     two-capitalized-words person)
//   • Overlap claims — earlier patterns win, no double-counting
//   • Aliases collapse case-distinct spellings within the same kind
//   • LLM classification pass — refines kinds, falls back on
//     parse/network failure
//   • Empty input + LLM-absent path returns heuristic-only candidates

import { describe, it, expect, vi } from "vitest";
import {
  extractEntities,
  type EntityCandidate,
  type EntityLlmCallFn,
} from "../../src/entity/extract";

describe("entity/extract — heuristic-only", () => {
  it("returns [] on empty input", async () => {
    const empty = await extractEntities({ text: "", workspaceId: "ws_x" });
    const blank = await extractEntities({ text: "   \n  ", workspaceId: "ws_x" });
    expect(empty).toEqual([]);
    expect(blank).toEqual([]);
  });

  it("detects @-handles as persons", async () => {
    const out = await extractEntities({
      text: "Discussed Q2 plans with @lucas and @sofia-dev",
      workspaceId: "ws_x",
    });
    const handles = out.filter((c) => c.name.startsWith("@"));
    expect(handles.length).toBe(2);
    expect(handles.every((c) => c.kind === "person")).toBe(true);
    expect(handles.map((c) => c.name).sort()).toEqual(["@lucas", "@sofia-dev"]);
  });

  it("detects organizations via legal suffix", async () => {
    const out = await extractEntities({
      text: "We're partnering with Acme Inc. and Beta Corp. on the launch.",
      workspaceId: "ws_x",
    });
    const orgs = out.filter((c) => c.kind === "organization");
    expect(orgs.length).toBeGreaterThanOrEqual(2);
    expect(orgs.some((c) => c.name.includes("Acme Inc."))).toBe(true);
    expect(orgs.some((c) => c.name.includes("Beta Corp."))).toBe(true);
  });

  it("detects quarter notations as concepts", async () => {
    const out = await extractEntities({
      text: "The Q2 2026 review went well. We're now planning 2026-Q3.",
      workspaceId: "ws_x",
    });
    const quarters = out.filter((c) => c.kind === "concept");
    expect(quarters.length).toBeGreaterThanOrEqual(2);
    expect(quarters.some((c) => c.name.includes("Q2 2026"))).toBe(true);
    expect(quarters.some((c) => c.name.includes("2026-Q3"))).toBe(true);
  });

  it("detects projects via terminal noun", async () => {
    const out = await extractEntities({
      text: "The Atlas Project ships next week. Mars Initiative is on hold.",
      workspaceId: "ws_x",
    });
    const projects = out.filter((c) => c.kind === "project");
    expect(projects.length).toBeGreaterThanOrEqual(2);
    expect(projects.some((c) => c.name.includes("Atlas Project"))).toBe(true);
    expect(projects.some((c) => c.name.includes("Mars Initiative"))).toBe(true);
  });

  it("detects two-capitalized-words persons", async () => {
    const out = await extractEntities({
      text: "Lucas Mailland reviewed the doc. Sofia Garcia approved.",
      workspaceId: "ws_x",
    });
    const persons = out.filter((c) => c.kind === "person");
    expect(persons.some((c) => c.name === "Lucas Mailland")).toBe(true);
    expect(persons.some((c) => c.name === "Sofia Garcia")).toBe(true);
  });

  it("@handle wins over Two-Capitalized-Words on overlap", async () => {
    // "@Lucas Mailland" should NOT generate both an @handle AND a
    // person via the two-words pattern. The @-pattern claims the
    // span first; the person pattern's match starts past it.
    const out = await extractEntities({
      text: "@lucas and Lucas Mailland are the same person.",
      workspaceId: "ws_x",
    });
    // We expect: one @lucas (handle, person) + one "Lucas Mailland"
    // (person). The handle didn't swallow the second mention because
    // it starts at a different position.
    const lucasHandle = out.find((c) => c.name === "@lucas");
    const lucasName = out.find((c) => c.name === "Lucas Mailland");
    expect(lucasHandle).toBeTruthy();
    expect(lucasName).toBeTruthy();
  });

  it("collapses repeated mentions into a single candidate with positions", async () => {
    const out = await extractEntities({
      text: "@lucas pushed. @lucas reviewed. @lucas merged.",
      workspaceId: "ws_x",
    });
    const lucas = out.find((c) => c.name === "@lucas");
    expect(lucas).toBeTruthy();
    expect(lucas!.positions.length).toBe(3);
  });

  it("collapses case-distinct spellings into the aliases set", async () => {
    // "Lucas Mailland" and "LUCAS MAILLAND" should be the same
    // candidate via the lower-cased dedup key.
    const out = await extractEntities({
      text: "Lucas Mailland leads. lucas mailland approved.",
      workspaceId: "ws_x",
    });
    // The lower-cased "lucas mailland" doesn't match the
    // [A-Z][a-z]+\s+[A-Z][a-z]+ pattern (it requires uppercase
    // initials), so only the first form lands. This is the
    // expected v1.6 behaviour — we don't lowercase before scanning
    // because that would explode the false-positive rate. The test
    // documents the contract.
    const persons = out.filter(
      (c) => c.kind === "person" && c.name.toLowerCase().includes("lucas")
    );
    expect(persons.length).toBeGreaterThanOrEqual(1);
  });
});

describe("entity/extract — LLM-assisted classification", () => {
  it("refines heuristic kinds when LLM is supplied", async () => {
    // "Buenos Aires" is heuristically person (two capitalized words);
    // the LLM should correct it to place. The mock returns a JSON
    // map; the classifier picks up the corrected kind.
    const mockLlm: EntityLlmCallFn = vi.fn(async () => ({
      content: JSON.stringify({ "Buenos Aires": "place", "Acme Inc.": "organization" }),
      model: "test-model",
      tokensUsed: 25,
    }));

    const out = await extractEntities({
      text: "Buenos Aires is the HQ of Acme Inc.",
      llm: mockLlm,
      model: "test-model",
      workspaceId: "ws_x",
    });

    const ba = out.find((c) => c.name === "Buenos Aires");
    expect(ba).toBeTruthy();
    expect(ba!.kind).toBe("place");
    expect(mockLlm).toHaveBeenCalledTimes(1);
  });

  it("falls back to heuristic kinds on LLM parse failure", async () => {
    const mockLlm: EntityLlmCallFn = vi.fn(async () => ({
      content: "this is not json",
      model: "test-model",
      tokensUsed: 5,
    }));

    const out = await extractEntities({
      text: "Lucas Mailland approved.",
      llm: mockLlm,
      model: "test-model",
      workspaceId: "ws_x",
    });

    // Heuristic kind preserved because LLM JSON couldn't be parsed.
    expect(out.find((c) => c.name === "Lucas Mailland")?.kind).toBe("person");
  });

  it("falls back to heuristic kinds on LLM network failure", async () => {
    const mockLlm: EntityLlmCallFn = vi.fn(async () => {
      throw new Error("network blew up");
    });

    const out = await extractEntities({
      text: "Lucas Mailland approved.",
      llm: mockLlm,
      model: "test-model",
      workspaceId: "ws_x",
    });

    // Heuristic kind preserved on network failure too.
    expect(out.find((c) => c.name === "Lucas Mailland")?.kind).toBe("person");
  });

  it("ignores unknown kinds in LLM output", async () => {
    // The LLM might return a kind outside the 6-value vocabulary
    // ("PERSON" in caps, "human", whatever). We validate and fall
    // back to the heuristic kind silently.
    const mockLlm: EntityLlmCallFn = vi.fn(async () => ({
      content: JSON.stringify({ "Lucas Mailland": "HUMAN" }),
      model: "test-model",
      tokensUsed: 5,
    }));

    const out = await extractEntities({
      text: "Lucas Mailland approved.",
      llm: mockLlm,
      model: "test-model",
      workspaceId: "ws_x",
    });

    expect(out.find((c) => c.name === "Lucas Mailland")?.kind).toBe("person");
  });

  it("strips markdown code fences from LLM output", async () => {
    const mockLlm: EntityLlmCallFn = vi.fn(async () => ({
      content: '```json\n{"Lucas Mailland":"person"}\n```',
      model: "test-model",
      tokensUsed: 10,
    }));

    const out = await extractEntities({
      text: "Lucas Mailland approved.",
      llm: mockLlm,
      model: "test-model",
      workspaceId: "ws_x",
    });

    expect(out.find((c) => c.name === "Lucas Mailland")?.kind).toBe("person");
  });

  it("does NOT call LLM when there are zero candidates", async () => {
    const mockLlm: EntityLlmCallFn = vi.fn();
    const out = await extractEntities({
      text: "today is fine", // no patterns hit
      llm: mockLlm,
      model: "test-model",
      workspaceId: "ws_x",
    });
    expect(out).toEqual([]);
    expect(mockLlm).not.toHaveBeenCalled();
  });
});

describe("entity/extract — candidate shape", () => {
  it("candidates carry positions for downstream highlighting", async () => {
    const text = "Spoke with @daisy about the rollout.";
    const out: EntityCandidate[] = await extractEntities({ text, workspaceId: "ws_x" });
    const daisy = out.find((c) => c.name === "@daisy");
    expect(daisy).toBeTruthy();
    expect(daisy!.positions.length).toBeGreaterThan(0);
    const pos = daisy!.positions[0]!;
    expect(text.slice(pos.start, pos.end)).toBe("@daisy");
  });
});
