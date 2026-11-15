import type { Capability } from "./catalog/types";
import { MODELS } from "./catalog/models";
import { resolveModel } from "./catalog";

export interface PickModelOpts {
  capability: Capability;
  tier?: "fast" | "smart" | "powerful";
  connectedProviderIds: string[];
  maxCostPer1k?: number;
}

/**
 * KNOW-12: Pick the cheapest catalog model that meets the given criteria among
 * connected providers. Returns null when no model qualifies.
 */
export function pickModel(opts: PickModelOpts): { id: string } | null {
  const connected = new Set(opts.connectedProviderIds);
  let candidates = MODELS.filter(
    (m) => m.capability === opts.capability && connected.has(m.provider)
  );
  if (opts.tier) candidates = candidates.filter((m) => m.tier === opts.tier);
  if (opts.maxCostPer1k != null) {
    const cap = opts.maxCostPer1k;
    candidates = candidates.filter((m) => (m.costPer1kOut ?? Infinity) <= cap);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.costPer1kOut ?? Infinity) - (b.costPer1kOut ?? Infinity));
  return { id: candidates[0]!.id };
}

/**
 * KNOW-12: Same-capability, same-tier alternates from providers OTHER than the
 * primary model's provider. Used as the default fallback chain in runChat when
 * the caller knows which providers are connected to the workspace.
 */
export function defaultFallbackChain(
  primaryModelId: string,
  connectedProviderIds: string[]
): string[] {
  const resolved = resolveModel(primaryModelId);
  if (!resolved || resolved.capability !== "chat") return [];
  const tier = MODELS.find((m) => m.id === resolved.modelId)?.tier;
  if (!tier) return [];
  const primaryProvider = resolved.provider.id;
  const others = new Set(connectedProviderIds.filter((id) => id !== primaryProvider));
  if (others.size === 0) return [];
  return MODELS.filter(
    (m) =>
      m.capability === "chat" &&
      m.tier === tier &&
      others.has(m.provider) &&
      m.id !== resolved.modelId
  ).map((m) => m.id);
}
