// apps/web/lib/settings/mnemo.ts
//
// Workspace-level Mnemosyne configuration.
//
// v1.5 (legacy — kept for backward compat reads):
//   • mnemo.enable_hyde      — boolean, default false. Opt-IN. Deprecated.
//   • mnemo.rerank_provider  — 'cohere' | null, default null. Opt-IN.
//
// v1.6 "True 10/10" — kill switches (defaults are "feature ON"):
//   • mnemo.disable_hyde     — boolean, default false → HyDE ON.
//   • mnemo.disable_rerank   — boolean, default false → rerank ON.
//   • mnemo.disable_graph    — boolean, default false → graph expansion ON.
//
// v1.6 — tiered embedding (workspace-level premium override):
//   • mnemo.premium_embedding_provider — 'openai' | 'voyage' | 'cohere' | null.
//   • mnemo.premium_embedding_model    — model id (e.g. 'text-embedding-3-large').
//
// Storage: we ride on the existing `feature_flag` table (jsonb `meta`
// is already provisioned). The boolean kill-switches store in `enabled`;
// rerank/premium config lives in `meta`. The settings surface stays a
// single table — adding a separate settings table for a few keys would
// be invasive, and operators can already flip flags via admin UI.
//
// Backward compat read rule: a feature is ON iff
//   - new disable_* flag is `false` (or absent), AND
//   - it's the default ON behaviour now.
// The legacy `enable_hyde=true` row continues to mean "definitely ON"
// (no-op since the v1.6 default is ON), and `disable_hyde=true` is the
// only way to opt OUT.
//
// Read path returns plain defaults on any failure — recall is an
// optimization and must NEVER crash because of a settings read.

import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import { safeLogError } from "@/lib/safe-log";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export type PremiumEmbeddingProvider = "openai" | "voyage" | "cohere";

export interface MnemoSettings {
  // ── v1.5 (legacy, kept for back-compat) ──────────────────────────────
  /** Deprecated v1.5 opt-in. Use `disableHyde` (default false → ON). */
  enableHyde: boolean;
  /** Deprecated v1.5 opt-in. Use `disableRerank` (default false → ON). */
  rerankProvider: "cohere" | null;
  /** Optional rerank model override (e.g. 'rerank-3.5'). */
  rerankModel?: string;

  // ── v1.6 (kill-switches — feature ON by default) ────────────────────
  /** Default false → HyDE ON. Set to true to disable HyDE for this workspace. */
  disableHyde: boolean;
  /** Default false → cross-encoder rerank ON. */
  disableRerank: boolean;
  /** Default false → graph 1-hop expansion ON. */
  disableGraph: boolean;

  // ── v1.6 (premium tier embedding) ───────────────────────────────────
  /**
   * Provider override for the premium embedding tier. NULL/undefined →
   * premium tier falls back to the default-tier provider (i.e. no
   * upgrade). When set, premium-tier facts (pinned / high-conf /
   * workspace-scope trait/preference/event) are embedded with this
   * provider's premium model.
   */
  premiumEmbeddingProvider?: PremiumEmbeddingProvider | null;
  /** Premium embedding model id. Resolved via `resolveEmbeddingTier`. */
  premiumEmbeddingModel?: string;
}

const DEFAULT_SETTINGS: MnemoSettings = {
  // Legacy: defaults preserved so back-compat reads keep their shape.
  enableHyde: false,
  rerankProvider: null,
  // v1.6 defaults — every kill-switch starts FALSE so the feature is ON.
  disableHyde: false,
  disableRerank: false,
  disableGraph: false,
  // Premium tier is opt-in (premium fact still resolves a tier — if the
  // workspace hasn't set the override, it falls back to default).
  premiumEmbeddingProvider: null,
};

// v1.5 legacy keys (still read for back-compat).
const FLAG_HYDE = "mnemo.enable_hyde";
const FLAG_RERANK = "mnemo.rerank_provider";
// v1.6 new keys.
const FLAG_DISABLE_HYDE = "mnemo.disable_hyde";
const FLAG_DISABLE_RERANK = "mnemo.disable_rerank";
const FLAG_DISABLE_GRAPH = "mnemo.disable_graph";
const FLAG_PREMIUM_EMBEDDING = "mnemo.premium_embedding";

/**
 * Load workspace Mnemosyne settings. Returns DEFAULT_SETTINGS on any
 * failure (DB error, malformed meta, missing rows). NEVER throws.
 */
export async function getMnemoSettings(workspaceId: string, tx?: WsDb): Promise<MnemoSettings> {
  try {
    const db = tx ?? getDb();
    const rows = await db
      .select({
        flagKey: schema.featureFlags.flagKey,
        enabled: schema.featureFlags.enabled,
        meta: schema.featureFlags.meta,
      })
      .from(schema.featureFlags)
      .where(eq(schema.featureFlags.workspaceId, workspaceId));

    const out: MnemoSettings = { ...DEFAULT_SETTINGS };

    for (const r of rows) {
      // ── v1.5 legacy reads (preserved exactly as before) ──────────
      if (r.flagKey === FLAG_HYDE) {
        out.enableHyde = Boolean(r.enabled);
        continue;
      }
      if (r.flagKey === FLAG_RERANK) {
        // The flag's `enabled` is the on/off switch; `meta.provider`
        // names the backend. Both are required for the setting to
        // take effect.
        if (!r.enabled) continue;
        const meta = (r.meta as Record<string, unknown> | null) ?? {};
        const provider = meta.provider;
        if (provider === "cohere") out.rerankProvider = "cohere";
        const model = meta.model;
        if (typeof model === "string" && model.length > 0) out.rerankModel = model;
        continue;
      }

      // ── v1.6 kill-switches ────────────────────────────────────────
      if (r.flagKey === FLAG_DISABLE_HYDE) {
        out.disableHyde = Boolean(r.enabled);
        continue;
      }
      if (r.flagKey === FLAG_DISABLE_RERANK) {
        out.disableRerank = Boolean(r.enabled);
        continue;
      }
      if (r.flagKey === FLAG_DISABLE_GRAPH) {
        out.disableGraph = Boolean(r.enabled);
        continue;
      }

      // ── v1.6 premium embedding ───────────────────────────────────
      if (r.flagKey === FLAG_PREMIUM_EMBEDDING) {
        if (!r.enabled) continue;
        const meta = (r.meta as Record<string, unknown> | null) ?? {};
        const provider = meta.provider;
        if (provider === "openai" || provider === "voyage" || provider === "cohere") {
          out.premiumEmbeddingProvider = provider;
        }
        const model = meta.model;
        if (typeof model === "string" && model.length > 0) out.premiumEmbeddingModel = model;
        continue;
      }
    }

    return out;
  } catch (e) {
    safeLogError(`[mnemo-settings] load failed for ws=${workspaceId}:`, e);
    return DEFAULT_SETTINGS;
  }
}

/** Setting keys — re-exported so callers / tests don't typo. */
export const MNEMO_SETTING_KEYS = {
  // v1.5 (legacy)
  ENABLE_HYDE: FLAG_HYDE,
  RERANK_PROVIDER: FLAG_RERANK,
  // v1.6 (new)
  DISABLE_HYDE: FLAG_DISABLE_HYDE,
  DISABLE_RERANK: FLAG_DISABLE_RERANK,
  DISABLE_GRAPH: FLAG_DISABLE_GRAPH,
  PREMIUM_EMBEDDING: FLAG_PREMIUM_EMBEDDING,
} as const;
