import { it, expect } from "vitest";
import { pickModel, defaultFallbackChain } from "@/lib/ai/routing";

it("pickModel returns cheapest chat model for a tier among connected providers", () => {
  const result = pickModel({
    capability: "chat",
    tier: "fast",
    connectedProviderIds: ["openai", "anthropic"],
  });
  expect(result).toBeTruthy();
  expect(typeof result!.id).toBe("string");
  // gpt-4o-mini cout=0.0006 < claude-haiku-4-5 cout=0.004 → openai wins
  expect(result!.id).toBe("openai:gpt-4o-mini");
});

it("pickModel returns null when no connected provider offers the capability", () => {
  expect(pickModel({ capability: "chat", connectedProviderIds: [] })).toBeNull();
});

it("pickModel without tier returns some model", () => {
  const result = pickModel({ capability: "chat", connectedProviderIds: ["openai"] });
  expect(result).toBeTruthy();
});

it("pickModel respects maxCostPer1k filter", () => {
  // o3 is powerful with cout=0.008; asking for maxCostPer1k=0.005 should exclude it
  const result = pickModel({
    capability: "chat",
    tier: "powerful",
    connectedProviderIds: ["openai"],
    maxCostPer1k: 0.005,
  });
  // o3 has cout=0.008 > 0.005, so nothing from openai matches
  expect(result).toBeNull();
});

it("defaultFallbackChain returns same-tier alternates from OTHER providers, excluding primary", () => {
  const chain = defaultFallbackChain("claude-sonnet-4-6", ["anthropic", "openai", "google"]);
  expect(Array.isArray(chain)).toBe(true);
  // primary and all anthropic models excluded
  expect(chain).not.toContain("claude-sonnet-4-6");
  expect(chain).not.toContain("anthropic:claude-sonnet-4-6");
  expect(chain.every((id: string) => !id.startsWith("anthropic:"))).toBe(true);
  // should have alternates from openai and google
  expect(chain.length).toBeGreaterThan(0);
});

it("defaultFallbackChain excludes primary provider when only it is connected", () => {
  const chain = defaultFallbackChain("anthropic:claude-sonnet-4-6", ["anthropic"]);
  expect(chain).toEqual([]);
});

it("defaultFallbackChain accepts canonical provider:model id", () => {
  const chain = defaultFallbackChain("openai:gpt-4o", ["openai", "anthropic", "google"]);
  expect(chain.every((id: string) => !id.startsWith("openai:"))).toBe(true);
  expect(chain.length).toBeGreaterThan(0);
});
