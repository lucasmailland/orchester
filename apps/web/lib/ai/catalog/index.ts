import type { Capability, ModelDef, ProviderDef } from "./types";
import { PROVIDERS, PROVIDERS_BY_ID } from "./providers";
import { MODELS } from "./models";

export * from "./types";
export { PROVIDERS, getProvider } from "./providers";
export { MODELS } from "./models";

const MODELS_BY_ID: Record<string, ModelDef> = Object.fromEntries(MODELS.map((x) => [x.id, x]));

export function getModel(id: string): ModelDef | undefined {
  return MODELS_BY_ID[id];
}

/** Proveedores que declaran una capacidad. */
export function providersFor(capability: Capability): ProviderDef[] {
  return PROVIDERS.filter((p) => p.capabilities.includes(capability));
}

/** Modelos de una capacidad (todo el catálogo). */
export function modelsFor(capability: Capability): ModelDef[] {
  return MODELS.filter((x) => x.capability === capability);
}

/** Modelos de una capacidad, sólo de los proveedores indicados (conectados). */
export function modelsForConnected(
  capability: Capability,
  connectedProviderIds: string[]
): ModelDef[] {
  const set = new Set(connectedProviderIds);
  return MODELS.filter((x) => x.capability === capability && set.has(x.provider));
}

export interface ResolvedModel {
  provider: ProviderDef;
  capability: Capability;
  /** id del modelo SIN el prefijo de proveedor (lo que espera la API del proveedor). */
  model: string;
  modelId: string;
}

/**
 * Resuelve un id de modelo. Acepta el formato canónico "provider:model" y, por
 * compatibilidad, ids de chat "pelados" (claude-…, gpt-…, gemini-…).
 */
export function resolveModel(modelId: string): ResolvedModel | null {
  const known = MODELS_BY_ID[modelId];
  if (known) {
    const provider = PROVIDERS_BY_ID[known.provider];
    if (!provider) return null;
    return {
      provider,
      capability: known.capability,
      model: stripPrefix(modelId, known.provider),
      modelId,
    };
  }
  // Formato provider:model aunque el modelo no esté en el catálogo (agregadores, ids libres).
  const idx = modelId.indexOf(":");
  if (idx > 0) {
    const providerId = modelId.slice(0, idx);
    const provider = PROVIDERS_BY_ID[providerId];
    if (provider) {
      const cap: Capability = provider.capabilities.includes("chat")
        ? "chat"
        : provider.capabilities[0]!;
      return { provider, capability: cap, model: modelId.slice(idx + 1), modelId };
    }
  }
  // Compat: ids de chat pelados.
  const legacy = legacyChatProvider(modelId);
  if (legacy) {
    const provider = PROVIDERS_BY_ID[legacy];
    if (provider)
      return { provider, capability: "chat", model: modelId, modelId: `${legacy}:${modelId}` };
  }
  return null;
}

function stripPrefix(modelId: string, provider: string): string {
  return modelId.startsWith(`${provider}:`) ? modelId.slice(provider.length + 1) : modelId;
}

function legacyChatProvider(model: string): string | null {
  if (model.startsWith("azure/") || model.startsWith("azure-")) return "azure_openai";
  if (model.startsWith("claude-")) return "anthropic";
  if (
    model.startsWith("gpt-") ||
    model.startsWith("o1-") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  )
    return "openai";
  if (model.startsWith("gemini-")) return "google";
  return null;
}
