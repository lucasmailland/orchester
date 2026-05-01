import { describe, it, expect } from "vitest";
import { routeToProvider, defaultModelsFor } from "../lib/providers";

describe("routeToProvider", () => {
  it("routes claude-* to anthropic", () => {
    expect(routeToProvider("claude-sonnet-4-6")).toBe("anthropic");
    expect(routeToProvider("claude-opus-4-7")).toBe("anthropic");
    expect(routeToProvider("claude-haiku-4-5")).toBe("anthropic");
  });
  it("routes gpt-*/o1-*/o3-* to openai", () => {
    expect(routeToProvider("gpt-4o")).toBe("openai");
    expect(routeToProvider("gpt-4o-mini")).toBe("openai");
    expect(routeToProvider("o1-preview")).toBe("openai");
    expect(routeToProvider("o3-mini")).toBe("openai");
  });
  it("routes gemini-* to google", () => {
    expect(routeToProvider("gemini-1.5-pro")).toBe("google");
    expect(routeToProvider("gemini-2.0-flash")).toBe("google");
  });
  it("routes azure/* to azure_openai", () => {
    expect(routeToProvider("azure/gpt-4o")).toBe("azure_openai");
  });
  it("returns null for unknown", () => {
    expect(routeToProvider("mystery-model-99")).toBeNull();
  });
});

describe("defaultModelsFor", () => {
  it("returns curated list for anthropic", () => {
    const m = defaultModelsFor("anthropic");
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]).toHaveProperty("id");
    expect(m[0]).toHaveProperty("tier");
  });
  it("returns curated list for openai", () => {
    expect(defaultModelsFor("openai").length).toBeGreaterThan(0);
  });
  it("returns curated list for google", () => {
    expect(defaultModelsFor("google").length).toBeGreaterThan(0);
  });
});
