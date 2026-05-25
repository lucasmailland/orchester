// packages/mnemosyne/src/modes/detect.ts
//
// §39 Operational Modes — Graceful Degradation.
//
// Two resolvers live here:
//   - `resolveConfiguredMode` (a.k.a. `resolveModeFromCapabilities`):
//     pure-code, config-based — given capability flags, return the
//     workspace's *intended* steady-state mode.
//   - `resolveActiveMode`: takes the configured mode + live provider
//     health and returns the mode the system can actually operate in
//     RIGHT NOW. Different from the configured mode iff a provider has
//     gone down (outage, rate limit, spend cap, network partition…).
//
//   Mode A — manual only (no providers, or LLM without embed)
//   Mode B — semantic recall (embed only, FTS fallback)
//   Mode C — full auto-extraction + recall (LLM + embed)
//
// The active mode is what the runtime uses to gate extraction jobs,
// recall blending, and capability advertisement. The configured mode
// is what the workspace owner sees in settings.

import type { ProviderHealth } from "./health";

export type MnemoMode = "A" | "B" | "C";

export interface CapabilitySnapshot {
  hasLLM: boolean;
  hasEmbed: boolean;
}

/**
 * Config-based resolver. Looks at what providers the workspace has wired up
 * and returns the *intended* steady-state mode.
 *
 * Use `resolveActiveMode` instead when you need to know what the system can
 * actually do RIGHT NOW (after health checks).
 */
export function resolveConfiguredMode(caps: CapabilitySnapshot): MnemoMode {
  if (caps.hasLLM && caps.hasEmbed) return "C";
  if (caps.hasEmbed) return "B";
  return "A";
}

/**
 * Back-compat alias — pre-1.1 call sites use this name. Kept exported from
 * `index.ts` so nothing downstream breaks.
 */
export const resolveModeFromCapabilities = resolveConfiguredMode;

/** Detail flags for partial-availability inside a degraded mode. */
export interface PartialAvailability {
  /** Can LLM extraction run? (i.e. chat provider is healthy) */
  extraction: boolean;
  /** Can semantic search run? (i.e. embedding provider is healthy) */
  semantic_search: boolean;
}

export type DegradationReason =
  | "chat_unavailable"
  | "embedding_unavailable"
  | "all_providers_unavailable";

export interface ResolveActiveModeInput {
  workspaceId: string;
  configured: MnemoMode;
  health: ProviderHealth;
}

export interface ActiveModeResult {
  active: MnemoMode;
  degraded: boolean;
  reason?: DegradationReason;
  partial?: PartialAvailability;
}

/**
 * Combine the workspace's configured mode with live provider health to
 * decide what mode the runtime can actually operate in.
 *
 * Decision matrix (configured → active):
 *
 *   C (LLM + embed configured):
 *     chat OK   + embed OK   → C, healthy
 *     chat OK   + embed DOWN → C-degraded (extraction works, semantic search disabled)
 *     chat DOWN + embed OK   → B-degraded (no extraction, semantic search still works)
 *     chat DOWN + embed DOWN → A-degraded (all providers down, FTS fallback only)
 *
 *   B (embed configured):
 *     embed OK   → B, healthy
 *     embed DOWN → A-degraded (FTS fallback only)
 *
 *   A (no providers wired up):
 *     active=A, healthy (this is steady state for trial / pre-onboarding)
 *
 * The `partial` field is set when the active mode masks a non-trivial
 * truth — e.g. configured=C but embedding down: we still report active=C
 * because extraction can run, but `partial.semantic_search=false` lets
 * the runtime skip the embedding step in recall.
 *
 * Async to leave room for future health-store fetches (today it's pure).
 */
export async function resolveActiveMode(input: ResolveActiveModeInput): Promise<ActiveModeResult> {
  const { configured, health } = input;

  if (configured === "A") {
    // No providers configured. Active mode mirrors configured mode and
    // we are not "degraded" — this is the documented steady state for
    // trial / pre-onboarding workspaces.
    return { active: "A", degraded: false };
  }

  if (configured === "B") {
    if (health.embedding) {
      return { active: "B", degraded: false };
    }
    return {
      active: "A",
      degraded: true,
      reason: "embedding_unavailable",
      partial: { extraction: false, semantic_search: false },
    };
  }

  // configured === "C"
  const chatOk = health.chat;
  const embedOk = health.embedding;

  if (chatOk && embedOk) {
    return { active: "C", degraded: false };
  }
  if (chatOk && !embedOk) {
    // Extraction can still run (LLM-only) but recall falls back to FTS.
    return {
      active: "C",
      degraded: true,
      reason: "embedding_unavailable",
      partial: { extraction: true, semantic_search: false },
    };
  }
  if (!chatOk && embedOk) {
    // No extraction, but semantic recall still works.
    return {
      active: "B",
      degraded: true,
      reason: "chat_unavailable",
      partial: { extraction: false, semantic_search: true },
    };
  }
  // !chatOk && !embedOk
  return {
    active: "A",
    degraded: true,
    reason: "all_providers_unavailable",
    partial: { extraction: false, semantic_search: false },
  };
}
