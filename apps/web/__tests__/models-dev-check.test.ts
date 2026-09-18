// @vitest-environment node
import { describe, expect, it } from "vitest";
// Plain JS script, no declaration file.
import { readCatalogue, differs } from "../scripts/check-models-dev.mjs";

interface Parsed {
  provider: string;
  model: string;
  id: string;
  cin?: number;
  cout?: number;
  ctx?: number;
}

const parse = (source: string) => readCatalogue(source) as Parsed[];

describe("reading the catalogue", () => {
  it("does not let a one-line entry swallow the next entry's numbers", () => {
    // The bug this test exists for: a body pattern that spans newlines runs
    // past a one-line entry's closing brace and pairs every model with its
    // neighbour's price. In the real catalogue that reported gpt-4o at
    // gpt-4o-mini's rate — a sixteen-fold error that looks like a billing
    // catastrophe and is really a parser off-by-one.
    const source = `
  m("openai", "gpt-4o", "GPT-4o", "chat", { tier: "smart", ctx: 128_000, cin: 0.0025, cout: 0.01 }),
  m("openai", "gpt-4o-mini", "GPT-4o mini", "chat", {
    tier: "fast",
    ctx: 128_000,
    cin: 0.00015,
    cout: 0.0006,
  }),
`;
    expect(parse(source)).toEqual([
      {
        provider: "openai",
        model: "gpt-4o",
        name: "GPT-4o",
        id: "openai:gpt-4o",
        cin: 0.0025,
        cout: 0.01,
        ctx: 128000,
      },
      {
        provider: "openai",
        model: "gpt-4o-mini",
        name: "GPT-4o mini",
        id: "openai:gpt-4o-mini",
        cin: 0.00015,
        cout: 0.0006,
        ctx: 128000,
      },
    ]);
  });

  it("reads the multi-line call form, where the id is its own argument", () => {
    const source = `
  m(
    "bedrock",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "Claude Haiku 4.5 (Bedrock)",
    "chat",
    {
      tier: "fast",
      ctx: 200_000,
      cin: 0.0011,
      cout: 0.0055,
    }
  ),
`;
    expect(parse(source)[0]).toMatchObject({
      id: "bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0",
      cin: 0.0011,
      cout: 0.0055,
    });
  });

  it("ignores a price that is only mentioned in a comment", () => {
    // Prices get discussed in comments right above the real ones, sometimes
    // spelled exactly like the field they are talking about.
    const source = `
  m("bedrock", "us.amazon.nova-2-lite-v1:0", "Nova 2 Lite", "chat", {
    ctx: 1_000_000,
    // el perfil global: cin: 0.0003, cout: 0.0025
    cin: 0.00033,
    cout: 0.00275,
  }),
`;
    expect(parse(source)[0]).toMatchObject({ cin: 0.00033, cout: 0.00275 });
  });

  it("keeps models that declare no price rather than inventing zero", () => {
    const source = `  m("replicate", "some-model", "Something", "chat", { tier: "smart" }),`;
    expect(parse(source)[0]).toMatchObject({ cin: undefined, cout: undefined });
  });

  it("leaves out anything that is not a chat model", () => {
    const source = `
  m("openai", "gpt-4o", "GPT-4o", "chat", { cin: 0.0025, cout: 0.01 }),
  m("openai", "text-embedding-3-small", "Embeddings", "embedding", { cin: 0.00002 }),
`;
    expect(parse(source).map((e) => e.model)).toEqual(["gpt-4o"]);
  });

  it("reads underscore separators as the numbers they are", () => {
    const source = `  m("openai", "x", "X", "chat", { ctx: 1_047_576, cin: 0.001, cout: 0.002 }),`;
    expect(parse(source)[0]!.ctx).toBe(1047576);
  });
});

describe("comparing numbers", () => {
  it("does not report floating point noise as drift", () => {
    expect(differs(0.1 + 0.2, 0.3)).toBe(false);
  });

  it("reports a real difference", () => {
    // The one this was built for: the global profile's rate on a regional id.
    expect(differs(0.003, 0.0033)).toBe(true);
  });

  it("says nothing when either side has no number", () => {
    expect(differs(undefined, 0.003)).toBe(false);
    expect(differs(0.003, undefined)).toBe(false);
  });
});
