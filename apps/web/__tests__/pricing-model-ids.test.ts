// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MODELS } from "@/lib/ai/catalog/models";
import { calculateChatCostUsd, calculateCostUsd, getCostPer1k } from "@/lib/pricing";

// Agents and channels store the full catalog id ("provider:model"); provider
// results carry the bare model. Both must price the same, and both must use
// the catalog price instead of the default rate.

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

function catalogPrice(id: string) {
  const entry = MODELS.find((m) => m.id === id);
  if (!entry || entry.costPer1kIn == null || entry.costPer1kOut == null) {
    throw new Error(`catalog entry without split price: ${id}`);
  }
  return { in: entry.costPer1kIn, out: entry.costPer1kOut };
}

const BEDROCK_SONNET = "bedrock:us.anthropic.claude-sonnet-4-6";
const ANTHROPIC_SONNET = "anthropic:claude-sonnet-4-6";
const bare = (id: string) => id.slice(id.indexOf(":") + 1);

describe("pricing by model id", () => {
  it.each([BEDROCK_SONNET, bare(BEDROCK_SONNET)])("prices %s with the catalog split", (model) => {
    const price = catalogPrice(BEDROCK_SONNET);
    expect(calculateChatCostUsd(model, 12_000, 3_000)).toBe(round6(12 * price.in + 3 * price.out));
  });

  it("resolves a direct provider id to its own catalog entry", () => {
    const price = catalogPrice(ANTHROPIC_SONNET);
    expect(calculateChatCostUsd(ANTHROPIC_SONNET, 4_000, 1_000)).toBe(
      round6(4 * price.in + 1 * price.out)
    );
  });

  it("resolves full ids in the blended helpers too", () => {
    const price = catalogPrice(BEDROCK_SONNET);
    const blended = (price.in + price.out) / 2;
    expect(getCostPer1k(BEDROCK_SONNET)).toBe(blended);
    expect(calculateCostUsd(BEDROCK_SONNET, 10_000)).toBe(round6(10 * blended));
  });

  it("falls back to the legacy tables by bare id", () => {
    // Neither model is in the catalog: they are priced only by the legacy tables.
    expect(calculateChatCostUsd("openai:gpt-4-turbo", 2_000, 500)).toBe(
      calculateChatCostUsd("gpt-4-turbo", 2_000, 500)
    );
    expect(calculateCostUsd("google:gemini-1.5-pro", 3_000)).toBe(
      calculateCostUsd("gemini-1.5-pro", 3_000)
    );
    expect(getCostPer1k("gemini-1.5-pro")).not.toBe(getCostPer1k("unknown-model"));
  });

  it("still falls back to the default rate for an unknown id", () => {
    const rate = getCostPer1k("acme:mystery-model");
    expect(rate).toBe(getCostPer1k("mystery-model"));
    expect(rate).toBe(getCostPer1k("another-unknown"));
    expect(calculateChatCostUsd("acme:mystery-model", 1_000, 1_000)).toBe(round6(2 * rate));
  });

  it("does not take an inherited object property for a price", () => {
    expect(getCostPer1k("constructor")).toBe(getCostPer1k("unknown-model"));
    expect(Number.isFinite(calculateChatCostUsd("acme:toString", 1_000, 1_000))).toBe(true);
  });
});

describe("prompt cache pricing", () => {
  // Anthropic models (direct and on Bedrock) bill cache writes at 1.25x and
  // cache reads at 0.1x the input price; providers report them apart from input.
  const price = catalogPrice(BEDROCK_SONNET);

  it("charges cache writes at 1.25x the input price", () => {
    expect(
      calculateChatCostUsd(BEDROCK_SONNET, 400, 300, { writeTokens: 7_000, readTokens: 0 })
    ).toBe(round6(0.4 * price.in + 0.3 * price.out + 7 * price.in * 1.25));
  });

  it("charges cache reads at 0.1x the input price", () => {
    expect(
      calculateChatCostUsd(BEDROCK_SONNET, 400, 300, { writeTokens: 0, readTokens: 7_000 })
    ).toBe(round6(0.4 * price.in + 0.3 * price.out + 7 * price.in * 0.1));
  });

  it("costs the same as before when there is no cache", () => {
    expect(calculateChatCostUsd(BEDROCK_SONNET, 400, 300, { writeTokens: 0, readTokens: 0 })).toBe(
      calculateChatCostUsd(BEDROCK_SONNET, 400, 300)
    );
  });

  it("prices cache tokens off the default rate for an unknown model", () => {
    const rate = getCostPer1k("acme:mystery-model");
    expect(
      calculateChatCostUsd("acme:mystery-model", 1_000, 1_000, {
        writeTokens: 2_000,
        readTokens: 10_000,
      })
    ).toBe(round6(2 * rate + 2 * rate * 1.25 + 10 * rate * 0.1));
  });
});
