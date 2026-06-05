// apps/web/lib/brain/model-resolve.ts
//
// Workspace model resolution for Brain Core / Mnemosyne.
//
// Per Mnemosyne Charter §25 (Provider Agnosticism) and the Phase 0
// audit (FIX-001/005/009), Brain MUST NOT carry hardcoded provider or
// model defaults. The model used for extraction is resolved from the
// workspace's configured `ai_provider` rows.
//
// Future Phase 2+ will introduce `workspace.mnemo.small_model` /
// `workspace.mnemo.embedding_*` settings explicitly. Until then we
// derive the "cheap tier" extraction model from the catalog by picking
// the first `tier:'fast'` chat model published by any enabled provider
// the workspace has wired up.
//
// If NO provider supplies a fast-tier chat model, this returns null —
// the caller (extract-job.ts) treats null as the Mode A signal and
// skips the extraction job (FIX-009).
import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type DbClient } from "@orchester/db";
import { MODELS } from "@/lib/ai/catalog";

type Tx = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export interface ResolvedSmallModel {
  /** Canonical model id passed to `llmCall` (e.g. `claude-haiku-4-5`). */
  modelId: string;
  /** Provider id, for debugging / audit logs. */
  providerId: string;
}

/**
 * Resolve the workspace's "small tier" chat model. Returns the FIRST
 * fast-tier chat model from the catalog whose provider has an
 * `ai_provider` row in this workspace with `enabled = true`.
 *
 * Returns null when no enabled provider publishes a fast-tier chat
 * model — that is the Mode A signal: extraction is unavailable, the
 * caller should mark the job `skipped` with `skip_reason='no_llm_provider'`.
 *
 * §25 compliance: this function never returns a string literal; it
 * always consults the workspace's configured providers + the catalog.
 */
export async function resolveSmallTierModel(
  workspaceId: string,
  tx: Tx
): Promise<ResolvedSmallModel | null> {
  const rows = await tx
    .select({ provider: schema.aiProviders.provider })
    .from(schema.aiProviders)
    .where(
      and(eq(schema.aiProviders.workspaceId, workspaceId), eq(schema.aiProviders.enabled, true))
    );
  if (rows.length === 0) return null;
  const enabled = new Set(rows.map((r) => r.provider));
  // Catalog already encodes tier metadata — we just pick the first
  // fast-tier chat model whose provider this workspace has enabled.
  //
  // The catalog stores ids as `provider:model`; `resolveModel()` accepts
  // either form, but historical callers (and `legacyChatProvider`) pass
  // the bare model id (e.g. `claude-haiku-4-5`). We strip the prefix here
  // so the value flows transparently through `llmCall`.
  for (const m of MODELS) {
    if (m.capability !== "chat") continue;
    if (m.tier !== "fast") continue;
    if (enabled.has(m.provider)) {
      const prefix = `${m.provider}:`;
      const bare = m.id.startsWith(prefix) ? m.id.slice(prefix.length) : m.id;
      return { modelId: bare, providerId: m.provider };
    }
  }
  return null;
}
