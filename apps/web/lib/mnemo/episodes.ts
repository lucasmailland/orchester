// apps/web/lib/mnemo/episodes.ts
//
// HTTP-only implementation of the workspace's episode timeline.
//
// Two helpers cover the read endpoints under /v1/episodes:
//   - listWorkspaceEpisodes  → GET /api/mnemo/episodes
//   - getWorkspaceEpisode    → GET /api/mnemo/episodes/[id]
//
// Both return a discriminated `{ mode, data }` envelope so the caller
// can stamp `X-Mnemo-Mode` on the response.

import "server-only";
import type { EpisodeWithLinkedFacts, ListEpisodesResponse } from "@mnemosyne/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

export { getMnemoMode };
export type { MnemoMode };

export async function listWorkspaceEpisodes(
  _workspaceId: string,
  opts: { from?: Date; to?: Date; topic?: string; limit: number; includeSynthetic?: boolean }
): Promise<{ mode: MnemoMode; data: ListEpisodesResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const data = await client.listEpisodes({
    ...(opts.from ? { from: opts.from.toISOString() } : {}),
    ...(opts.to ? { to: opts.to.toISOString() } : {}),
    ...(opts.topic ? { topic: opts.topic } : {}),
    limit: opts.limit,
    ...(opts.includeSynthetic !== undefined ? { includeSynthetic: opts.includeSynthetic } : {}),
  });
  return { mode, data };
}

export async function getWorkspaceEpisode(
  _workspaceId: string,
  id: string
): Promise<{ mode: MnemoMode; data: EpisodeWithLinkedFacts | null }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  try {
    const data = await client.getEpisode(id);
    return { mode, data };
  } catch (e) {
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }
}
