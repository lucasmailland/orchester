import { describe, it, expect } from "vitest";
import { PROVIDERS } from "@/lib/ai/catalog/providers";
import { EXECUTABLE_CAPABILITIES } from "@/lib/ai/catalog/types";

it("every provider declares an `implemented` flag", () => {
  for (const p of PROVIDERS) {
    expect(typeof p.implemented, `provider ${p.id} missing implemented flag`).toBe("boolean");
  }
});

it("bespoke providers are marked NOT implemented; chat families are implemented", () => {
  const bespoke = PROVIDERS.filter((p) => p.family === "bespoke");
  expect(bespoke.length).toBeGreaterThan(0);
  expect(bespoke.every((p) => p.implemented === false)).toBe(true);
  const openai = PROVIDERS.find((p) => p.id === "openai")!;
  const anthropic = PROVIDERS.find((p) => p.id === "anthropic")!;
  expect(openai.implemented).toBe(true);
  expect(anthropic.implemented).toBe(true);
});
