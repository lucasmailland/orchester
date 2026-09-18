import "server-only";
import type { ModelInfo } from "@orchester/db";
import { fetchWithTimeout } from "./http-util";
import { MODELS } from "./ai/catalog/models";

const PROVIDER_TEST_TIMEOUT_MS = 30_000;

export type ProviderType = "anthropic" | "openai" | "google" | "azure_openai" | "bedrock";

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

/**
 * Bedrock's CONTROL plane, which is a different host from the runtime one.
 * `endpoint` takes the same two shapes the operator may already have typed for
 * the runtime: a full URL or just a region.
 */
function bedrockControlPlaneUrl(endpoint?: string | null): string {
  const e = endpoint?.trim().replace(/\/$/, "");
  if (!e) return "https://bedrock.us-east-1.amazonaws.com";
  if (e.startsWith("http://") || e.startsWith("https://")) {
    // A runtime URL was configured; the control plane is its sibling host.
    return e.replace("bedrock-runtime.", "bedrock.");
  }
  return `https://bedrock.${e}.amazonaws.com`;
}

/** Context windows the catalogue knows; the AWS APIs do not report them. */
const BEDROCK_CONTEXT: Record<string, number> = Object.fromEntries(
  MODELS.filter((m) => m.provider === "bedrock" && m.contextWindow).map((m) => [
    m.id.replace(/^bedrock:/, ""),
    m.contextWindow!,
  ])
);

interface BedrockModelSummary {
  modelArn?: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  outputModalities?: string[];
  inferenceTypesSupported?: string[];
  modelLifecycle?: { status?: string };
}
interface BedrockProfileSummary {
  inferenceProfileId?: string;
  inferenceProfileName?: string;
  status?: string;
  models?: { modelArn?: string }[];
}

/**
 * Ask Bedrock what this account can actually call.
 *
 * Two calls, because neither answers on its own:
 *   - `/foundation-models` is the regional catalogue — names and ids, but many
 *     of those ids are not callable directly.
 *   - `/inference-profiles` gives the `us.`-prefixed ids that ARE callable.
 *     Without it, a bare id answers "isn't supported with on-demand
 *     throughput. Retry with the ID or ARN of an inference profile", which is
 *     the error this whole lookup exists to avoid.
 *
 * Neither reports whether the account is entitled to a given model — that is
 * `GetFoundationModelAvailability`, one request per model, far too many for a
 * button press. A model that is listed but not enabled fails at call time with
 * an AccessDenied naming the Bedrock console, which is a clear enough message.
 */
async function testBedrock(
  apiKey: string,
  endpoint?: string | null
): Promise<{ ok: boolean; models?: ModelInfo[]; error?: string }> {
  const base = bedrockControlPlaneUrl(endpoint);
  const headers = { authorization: `Bearer ${apiKey}` };
  const r = await fetchWithTimeout(
    `${base}/foundation-models?byOutputModality=TEXT`,
    { headers },
    PROVIDER_TEST_TIMEOUT_MS
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    if (r.status === 401 || r.status === 403) {
      return {
        ok: false,
        error: `Bedrock rejected the key for listing models (${r.status}). The key must allow Amazon Bedrock actions, not only Bedrock Runtime. ${body.slice(0, 200)}`,
      };
    }
    return { ok: false, error: `Bedrock returned ${r.status}: ${body.slice(0, 200)}` };
  }
  const listed = ((await r.json()) as { modelSummaries?: BedrockModelSummary[] }).modelSummaries;

  // Profiles are a nice-to-have: without them the list is still useful, just
  // missing the models that can only be reached through one.
  const profilesResponse = await fetchWithTimeout(
    `${base}/inference-profiles?type=SYSTEM_DEFINED&maxResults=1000`,
    { headers },
    PROVIDER_TEST_TIMEOUT_MS
  ).catch(() => null);
  const profiles: BedrockProfileSummary[] = profilesResponse?.ok
    ? (((await profilesResponse.json()) as { inferenceProfileSummaries?: BedrockProfileSummary[] })
        .inferenceProfileSummaries ?? [])
    : [];
  const profileByModelArn = new Map<string, string>();
  for (const p of profiles) {
    if (p.status && p.status !== "ACTIVE") continue;
    if (!p.inferenceProfileId) continue;
    for (const m of p.models ?? []) {
      // First profile wins, so a model with us/eu/apac profiles keeps one entry.
      if (m.modelArn && !profileByModelArn.has(m.modelArn)) {
        profileByModelArn.set(m.modelArn, p.inferenceProfileId);
      }
    }
  }

  const models: ModelInfo[] = [];
  for (const summary of listed ?? []) {
    if (!summary.modelId) continue;
    if (!(summary.outputModalities ?? ["TEXT"]).includes("TEXT")) continue;
    // A model past its end of life is noise in a picker.
    if (summary.modelLifecycle?.status === "LEGACY") continue;
    const profileId = summary.modelArn ? profileByModelArn.get(summary.modelArn) : undefined;
    const onDemand = (summary.inferenceTypesSupported ?? []).includes("ON_DEMAND");
    // Prefer the id that actually works: on-demand models answer to the bare
    // id, the rest only through their profile.
    const callable = onDemand ? summary.modelId : profileId;
    if (!callable) continue;
    const label = summary.modelName ?? summary.modelId;
    models.push({
      id: `bedrock:${callable}`,
      name: summary.providerName ? `${summary.providerName} ${label}` : label,
      // Unknown unless the catalogue happens to carry it; the picker hides a 0.
      contextWindow: BEDROCK_CONTEXT[callable] ?? 0,
      tier: "smart",
    });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  if (models.length === 0) {
    return { ok: false, error: "Bedrock listed no text models for this region." };
  }
  return { ok: true, models };
}

/** Test connection by calling the provider's models endpoint. */
export async function testProviderConnection(
  provider: string,
  apiKey: string,
  endpoint?: string | null
): Promise<{ ok: boolean; models?: ModelInfo[]; error?: string }> {
  try {
    if (provider === "anthropic") {
      const r = await fetchWithTimeout(
        "https://api.anthropic.com/v1/models",
        {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        },
        PROVIDER_TEST_TIMEOUT_MS
      );
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
      const r = await fetchWithTimeout(
        "https://api.openai.com/v1/models",
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        PROVIDER_TEST_TIMEOUT_MS
      );
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
      const r = await fetchWithTimeout(
        url,
        { headers: { "api-key": apiKey } },
        PROVIDER_TEST_TIMEOUT_MS
      );
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
    if (provider === "bedrock") return await testBedrock(apiKey, endpoint);
    return { ok: false, error: "Unknown provider" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
