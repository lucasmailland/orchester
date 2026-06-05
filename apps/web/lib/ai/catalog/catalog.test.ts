import { describe, it, expect } from "vitest";
import { PROVIDERS, getProvider } from "./providers";
import { MODELS } from "./models";
import { resolveModel, modelsFor, modelsForConnected } from "./index";

describe("catalog integrity", () => {
  it("every model points to a known provider that declares the capability", () => {
    for (const model of MODELS) {
      const p = getProvider(model.provider);
      expect(p, `provider ${model.provider} for model ${model.id}`).toBeDefined();
      expect(p!.capabilities, `${model.provider} should declare ${model.capability}`).toContain(
        model.capability
      );
    }
  });

  it("model ids are unique and namespaced provider:model", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODELS) expect(m.id).toBe(`${m.provider}:${m.id.slice(m.provider.length + 1)}`);
  });

  it("provider ids are unique", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("openai-compatible providers declare a baseURL (unless the endpoint is user-supplied)", () => {
    for (const p of PROVIDERS) {
      if (p.family === "openai-compatible" && p.auth !== "api_key+endpoint") {
        expect(p.baseURL, `${p.id} needs baseURL`).toBeTruthy();
      }
    }
  });
});

describe("resolveModel", () => {
  it("resolves a canonical provider:model id", () => {
    const r = resolveModel("openai:gpt-image-1");
    expect(r?.provider.id).toBe("openai");
    expect(r?.capability).toBe("image");
    expect(r?.model).toBe("gpt-image-1");
  });

  it("resolves legacy bare chat ids", () => {
    expect(resolveModel("claude-sonnet-4-6")?.provider.id).toBe("anthropic");
    expect(resolveModel("gpt-4o")?.provider.id).toBe("openai");
    expect(resolveModel("gemini-2.5-pro")?.provider.id).toBe("google");
  });

  it("resolves free-form aggregator ids not in the catalog", () => {
    const r = resolveModel("replicate:some-org/some-model");
    expect(r?.provider.id).toBe("replicate");
    expect(r?.model).toBe("some-org/some-model");
  });

  it("returns null for unknown providers", () => {
    expect(resolveModel("nope:whatever")).toBeNull();
  });
});

describe("model listing", () => {
  it("modelsFor filters by capability", () => {
    expect(modelsFor("image").every((m) => m.capability === "image")).toBe(true);
    expect(modelsFor("chat").length).toBeGreaterThan(5);
  });

  it("modelsForConnected only returns connected providers", () => {
    const out = modelsForConnected("chat", ["anthropic"]);
    expect(out.every((m) => m.provider === "anthropic")).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });
});
