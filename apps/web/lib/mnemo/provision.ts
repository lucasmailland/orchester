// apps/web/lib/mnemo/provision.ts
//
// Auto-provision the workspace's LLM provider into Mnemosyne so its
// internal LLM-dependent paths (embedding, future crons) use *this*
// workspace's credentials — same key the user just configured in the
// Orchester Settings UI. Zero duplication, single source of truth.
//
// Fire-and-forget: a failure here is non-fatal for the host's own
// provider save. The Settings UI shows the synced state in a separate
// status panel.
import "server-only";
import type { WorkspaceConfigProvider } from "@mnemosyne/client-ts";
import { getMnemoClient } from "@/lib/mnemo/client";
import { safeLogError } from "@/lib/safe-log";

/**
 * Map an Orchester provider id ("openai", "anthropic", "google") to
 * Mnemosyne's WorkspaceConfigProvider. Returns null for providers
 * Mnemosyne doesn't use for memory operations (it doesn't need a
 * Stripe key, etc).
 */
function toMnemoProvider(provider: string): WorkspaceConfigProvider | null {
  switch (provider) {
    case "openai":
    case "anthropic":
    case "google":
      return provider;
    default:
      return null;
  }
}

/**
 * Sync a workspace's provider credentials to Mnemosyne. Idempotent —
 * the SDK's `upsertWorkspaceConfig` does the right thing whether the
 * row exists or not. The plaintext key never lands in a log line.
 *
 * Call this AFTER the orchester `ai_provider` row is persisted.
 */
export async function syncProviderToMnemosyne(args: {
  workspaceId: string;
  provider: string;
  /** PLAINTEXT key (just decrypted from ai_provider.apiKey). */
  apiKey: string;
  /** Optional base URL — forwarded for openai-compat self-host setups. */
  baseUrl?: string | null;
}): Promise<{ synced: boolean; reason?: string }> {
  const mnemoProvider = toMnemoProvider(args.provider);
  if (!mnemoProvider) {
    return { synced: false, reason: "provider_not_used_by_mnemosyne" };
  }
  try {
    const client = getMnemoClient();
    await client.upsertWorkspaceConfig({
      llmProvider: mnemoProvider,
      llmApiKey: args.apiKey,
      ...(args.baseUrl ? { llmBaseUrl: args.baseUrl } : {}),
    });
    return { synced: true };
  } catch (e) {
    safeLogError("[mnemo/provision] upsertWorkspaceConfig failed:", e);
    return { synced: false, reason: "sdk_call_failed" };
  }
}
