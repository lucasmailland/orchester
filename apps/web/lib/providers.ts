import "server-only";
import type { ModelInfo } from "@orchester/db";
import { fetchWithTimeout } from "./http-util";

const PROVIDER_TEST_TIMEOUT_MS = 30_000;

export type ProviderType = "anthropic" | "openai" | "google" | "azure_openai";

// Nota: el ruteo modelo→proveedor vive en el catálogo (`lib/ai/catalog/index.ts`
// → `legacyChatProvider`/`resolveModel`). Las funciones `routeToProvider` y
// `defaultModelsFor` que vivían acá quedaron obsoletas y se removieron (A3/A4).
// Los arrays de abajo se conservan: `testProviderConnection` los usa de fallback.

const ANTHROPIC: ModelInfo[] = [
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", contextWindow: 200_000, tier: "powerful" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 200_000, tier: "smart" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200_000, tier: "fast" },
];
const OPENAI: ModelInfo[] = [
  { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000, tier: "smart" },
  { id: "gpt-4o-mini", name: "GPT-4o mini", contextWindow: 128_000, tier: "fast" },
  { id: "o3-mini", name: "o3-mini", contextWindow: 200_000, tier: "powerful" },
];
const GOOGLE: ModelInfo[] = [
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextWindow: 2_000_000, tier: "powerful" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextWindow: 1_000_000, tier: "fast" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1_000_000, tier: "smart" },
];

/** Test connection by calling the provider's models endpoint. */
export async function testProviderConnection(
  provider: string,
  apiKey: string,
  endpoint?: string | null
): Promise<{ ok: boolean; models?: ModelInfo[]; error?: string }> {
  try {
    if (provider === "anthropic") {
      const r = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      }, PROVIDER_TEST_TIMEOUT_MS);
      if (!r.ok) return { ok: false, error: `Anthropic returned ${r.status}` };
      const j = await r.json();
      const models: ModelInfo[] = (j.data || []).map(
        (m: { id: string; display_name?: string }) => ({
          id: m.id,
          name: m.display_name ?? m.id,
          contextWindow: 200_000,
          tier: m.id.includes("opus")
            ? ("powerful" as const)
            : m.id.includes("haiku")
            ? ("fast" as const)
            : ("smart" as const),
        })
      );
      return { ok: true, models: models.length ? models : ANTHROPIC };
    }
    if (provider === "openai") {
      const r = await fetchWithTimeout("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      }, PROVIDER_TEST_TIMEOUT_MS);
      if (!r.ok) return { ok: false, error: `OpenAI returned ${r.status}` };
      const j = await r.json();
      const ids = new Set<string>((j.data || []).map((m: { id: string }) => m.id));
      const models = OPENAI.filter((m) => ids.has(m.id));
      return { ok: true, models: models.length ? models : OPENAI };
    }
    if (provider === "google") {
      const r = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        undefined,
        PROVIDER_TEST_TIMEOUT_MS
      );
      if (!r.ok) return { ok: false, error: `Google returned ${r.status}` };
      const j = await r.json();
      const ids = new Set<string>(
        (j.models || []).map((m: { name: string }) => m.name.replace(/^models\//, ""))
      );
      const models = GOOGLE.filter((m) => ids.has(m.id));
      return { ok: true, models: models.length ? models : GOOGLE };
    }
    if (provider === "azure_openai") {
      if (!endpoint) return { ok: false, error: "Azure requires an endpoint URL" };
      const url = `${endpoint.replace(/\/$/, "")}/openai/deployments?api-version=2024-02-01`;
      const r = await fetchWithTimeout(url, { headers: { "api-key": apiKey } }, PROVIDER_TEST_TIMEOUT_MS);
      if (!r.ok) return { ok: false, error: `Azure returned ${r.status}` };
      const j = await r.json();
      const models: ModelInfo[] = (j.data || []).map((d: { id: string }) => ({
        id: `azure/${d.id}`,
        name: `Azure: ${d.id}`,
        contextWindow: 128_000,
        tier: "smart" as const,
      }));
      return { ok: true, models };
    }
    return { ok: false, error: "Unknown provider" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
