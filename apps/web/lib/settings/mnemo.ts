// apps/web/lib/settings/mnemo.ts
//
// Workspace-level Mnemosyne configuration. Two opt-in switches (both
// default-off so cost doesn't appear without explicit operator action):
//
//   • mnemo.enable_hyde      — boolean, default false. When true,
//                              the recall path runs HyDE (one extra
//                              cheap LLM call per turn that triggers
//                              recall) before embedding the query.
//
//   • mnemo.rerank_provider  — 'cohere' | null, default null. When set
//                              to 'cohere' AND the COHERE_API_KEY env
//                              var is present, the merged unified-
//                              recall set is cross-encoder reranked
//                              before the hard top-K cap.
//
// Storage: we ride on the existing `feature_flag` table (jsonb `meta`
// is already provisioned). `enable_hyde` lives in the row's `enabled`
// boolean; `rerank_provider` lives in `meta.provider`. This keeps the
// settings surface a single table — adding a separate settings table
// just to host two keys would be invasive, and operators can already
// flip flags via the existing admin UI.
//
// Read path returns plain defaults on any failure — recall is an
// optimization and must NEVER crash because of a settings read.

import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import { safeLogError } from "@/lib/safe-log";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export interface MnemoSettings {
  /** Default false. Opt-in because each HyDE call costs a cheap LLM round-trip. */
  enableHyde: boolean;
  /**
   * Default null. Opt-in because cross-encoder reranking needs an
   * external API key (Cohere today; v2.0 may add Voyage / Jina).
   */
  rerankProvider: "cohere" | null;
}

const DEFAULT_SETTINGS: MnemoSettings = {
  enableHyde: false,
  rerankProvider: null,
};

const FLAG_HYDE = "mnemo.enable_hyde";
const FLAG_RERANK = "mnemo.rerank_provider";

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

    let enableHyde = DEFAULT_SETTINGS.enableHyde;
    let rerankProvider: MnemoSettings["rerankProvider"] = DEFAULT_SETTINGS.rerankProvider;

    for (const r of rows) {
      if (r.flagKey === FLAG_HYDE) {
        enableHyde = Boolean(r.enabled);
        continue;
      }
      if (r.flagKey === FLAG_RERANK) {
        // The flag's `enabled` is the on/off switch; `meta.provider`
        // names the backend. Both are required for the setting to
        // take effect.
        if (!r.enabled) continue;
        const provider = (r.meta as Record<string, unknown> | null)?.provider;
        if (provider === "cohere") rerankProvider = "cohere";
        continue;
      }
    }

    return { enableHyde, rerankProvider };
  } catch (e) {
    safeLogError(`[mnemo-settings] load failed for ws=${workspaceId}:`, e);
    return DEFAULT_SETTINGS;
  }
}

/** Setting keys — re-exported so callers / tests don't typo. */
export const MNEMO_SETTING_KEYS = {
  ENABLE_HYDE: FLAG_HYDE,
  RERANK_PROVIDER: FLAG_RERANK,
} as const;
