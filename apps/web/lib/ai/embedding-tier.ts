// apps/web/lib/ai/embedding-tier.ts
//
// Mnemosyne v1.6 — Tiered embedding resolver.
//
// Some facts matter more than others. A pinned fact, a workspace-scope
// trait, or a high-confidence preference deserves the best embedding
// the workspace can afford — recall on these is the difference between
// a competent agent and a forgetful one. A random conversation-scope
// "the user asked for the time" fact does not.
//
// This module classifies each fact into one of two tiers:
//
//   • 'premium' — pinned OR confidence >= 0.85 OR (workspace-scope AND
//                 kind in {trait, preference, event}). Uses the
//                 workspace's premium-tier embedding model when one
//                 is configured.
//   • 'default' — everything else. Uses the workspace's default
//                 embedding model (the same one `embed-batch-job.ts`
//                 has always used).
//
// Charter §25: NEVER hardcode provider/model strings. All resolution
// reads from the workspace's settings + ai_provider rows. Mirror of the
// pattern in `apps/web/lib/brain/model-resolve.ts`.
//
// Returns null when the workspace has no embedding provider at all
// (Mode A — caller stores the fact with `embedding = NULL` and FTS
// covers the gap until a provider is configured).
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import { defaultEmbeddingModel, type EmbeddingProvider } from "@/lib/embeddings";
import { getMnemoSettings } from "@/lib/settings/mnemo";
import { safeLogError } from "@/lib/safe-log";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export type EmbeddingTier = "default" | "premium";

export interface ResolveEmbeddingTierInput {
  workspaceId: string;
  /** v1.4 fact kind. Used in the premium-tier classifier. */
  factKind?: string;
  /** When true, the fact is always premium. */
  pinned?: boolean;
  /** [0, 1]. >= 0.85 promotes the fact to premium. */
  confidence?: number;
  /**
   * Fact scope. 'workspace' is short-hand for fact scope='global' in
   * the current schema. Accepted aliases so callers don't have to map
   * the term: 'workspace' OR 'global'. Anything else stays default-tier
   * (per-conversation / per-employee facts are usually noise).
   */
  scope?: "workspace" | "agent" | "conversation" | "global" | "employee" | "team";
  /**
   * Optional explicit override — if the caller already knows the tier
   * (e.g. it was set via `mnemosyne_remember` with a pinned hint), they
   * can short-circuit. When set we still resolve the provider/model so
   * the caller gets a ResolvedEmbeddingTier with the right config.
   */
  tier?: EmbeddingTier;
  /** Workspace transaction. Honored when present. */
  tx?: WsDb;
}

export interface ResolvedEmbeddingTier {
  tier: EmbeddingTier;
  provider: EmbeddingProvider;
  model: string;
}

/** Confidence threshold above which a fact is promoted to premium tier. */
const PREMIUM_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Kinds that promote a workspace-scope fact to premium. These are the
 * "biographical" categories — knowing them well is the single biggest
 * recall-quality lever for a long-running agent.
 */
const PREMIUM_KINDS = new Set<string>(["trait", "preference", "event"]);

/**
 * Classify a fact into an embedding tier based on its attributes.
 * Pure: no IO, deterministic for a given input.
 */
function classifyTier(input: ResolveEmbeddingTierInput): EmbeddingTier {
  if (input.tier) return input.tier;
  if (input.pinned === true) return "premium";
  if (typeof input.confidence === "number" && input.confidence >= PREMIUM_CONFIDENCE_THRESHOLD) {
    return "premium";
  }
  const isWorkspaceScope = input.scope === "workspace" || input.scope === "global";
  if (isWorkspaceScope && input.factKind && PREMIUM_KINDS.has(input.factKind)) {
    return "premium";
  }
  return "default";
}

/**
 * Pick the first enabled embedding-capable provider for the workspace.
 * Mirror of `resolveWorkspaceEmbeddingProvider` in `embed-batch-job.ts`
 * — duplicated here to avoid creating a circular import (embed-batch
 * already imports this file via Step 4).
 */
async function resolveDefaultProvider(
  workspaceId: string,
  tx?: WsDb
): Promise<EmbeddingProvider | null> {
  const db = tx ?? getDb();
  const rows = await db
    .select({ provider: schema.aiProviders.provider })
    .from(schema.aiProviders)
    .where(
      and(eq(schema.aiProviders.workspaceId, workspaceId), eq(schema.aiProviders.enabled, true))
    );
  const set = new Set(rows.map((r) => r.provider));
  // Prefer openai (cheapest embedding default), then google. Voyage and
  // Cohere are premium-only — the default tier sticks to the cheap path.
  if (set.has("openai")) return "openai";
  if (set.has("google")) return "google";
  return null;
}

/**
 * Resolve the embedding tier + provider + model for a fact.
 *
 * Decision flow:
 *   1. Classify into tier (default | premium) via classifyTier.
 *   2. Resolve the default-tier provider for the workspace.
 *   3. If tier === 'premium' AND the workspace has set both a
 *      premium provider AND model in mnemo settings → use those.
 *   4. Else → use the default-tier provider's defaultEmbeddingModel.
 *   5. If no embedding provider at all → return null (Mode A).
 *
 * Returns null on any failure of step 5; never throws. The caller
 * (createFact/embed-batch) treats null as "store with NULL embedding".
 *
 * Charter §25: provider/model are always sourced from
 * workspace.ai_provider + workspace settings, never a string literal.
 */
export async function resolveEmbeddingTier(
  input: ResolveEmbeddingTierInput
): Promise<ResolvedEmbeddingTier | null> {
  try {
    const tier = classifyTier(input);

    // Always resolve the default-tier provider — it's the fallback for
    // a premium-classified fact when the workspace hasn't configured a
    // premium override (the upgrade is opt-in per workspace).
    const defaultProvider = await resolveDefaultProvider(input.workspaceId, input.tx);
    if (!defaultProvider) {
      // Mode A — no embedding provider at all. The caller stores the
      // fact with embedding=NULL and FTS covers recall.
      return null;
    }

    if (tier === "default") {
      return {
        tier: "default",
        provider: defaultProvider,
        model: defaultEmbeddingModel(defaultProvider),
      };
    }

    // Premium tier — consult workspace settings for the override.
    const settings = await getMnemoSettings(input.workspaceId, input.tx);
    const premiumProvider = settings.premiumEmbeddingProvider;
    const premiumModel = settings.premiumEmbeddingModel;
    // The settings layer accepts 'cohere' (and future providers) for
    // forward-compat, but the runtime `embed()` function only ships
    // OpenAI + Google + Voyage backends right now. Narrow here.
    if (premiumProvider && premiumModel && isSupportedEmbeddingProvider(premiumProvider)) {
      return {
        tier: "premium",
        provider: premiumProvider,
        model: premiumModel,
      };
    }

    // Premium classifier matched but the workspace hasn't opted in to
    // a premium override. Fall back to default-tier config so the fact
    // still gets embedded — just not with the upgrade. We still report
    // the resolved tier as 'default' here so metering / billing
    // attributes the cost correctly.
    return {
      tier: "default",
      provider: defaultProvider,
      model: defaultEmbeddingModel(defaultProvider),
    };
  } catch (e) {
    safeLogError(`[embedding-tier] resolve failed for ws=${input.workspaceId}:`, e);
    return null;
  }
}

/**
 * Pure classifier — exported for tests and the embed-batch grouper.
 *
 * Same rules as the full resolve path but with no IO. Useful when the
 * caller already has a ResolvedEmbeddingTier in hand and just wants to
 * re-derive the tier from a fact row's attrs (e.g. embed-batch
 * grouping pending facts by tier).
 */
export function classifyEmbeddingTier(input: ResolveEmbeddingTierInput): EmbeddingTier {
  return classifyTier(input);
}

/**
 * Narrows the open-set `PremiumEmbeddingProvider` (settings UI lists
 * 'openai' | 'voyage' | 'cohere' for forward-compat) to the subset the
 * runtime `embed()` function actually supports. Cohere lands here as
 * `false` and the resolver falls back to default-tier.
 */
function isSupportedEmbeddingProvider(p: string): p is EmbeddingProvider {
  return p === "openai" || p === "google" || p === "voyage";
}
