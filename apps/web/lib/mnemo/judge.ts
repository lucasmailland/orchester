// apps/web/lib/mnemo/judge.ts
//
// HTTP-only wrappers for the conflict-resolution surface (memory_judge).
//   - listWorkspaceConflicts   → GET  /conflicts?limit=<=20
//   - resolveWorkspaceConflict → POST /conflicts/:id/resolve
//
// judge() server-caps limit at 20 (types.ts:1742) — we clamp here too so a
// route can't accidentally request more. resolveConflict 404s when the
// relationId is unknown → mapped to data:null.
import "server-only";
import type {
  ListConflictsResponse,
  ResolveConflictInput,
  ResolveConflictResponse,
} from "@mnemo-ai/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

export { getMnemoMode };
export type { MnemoMode };

const MAX_CONFLICT_LIMIT = 20;

export async function listWorkspaceConflicts(
  workspaceId: string,
  opts: { limit?: number } = {}
): Promise<{ mode: MnemoMode; data: ListConflictsResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  const limit = Math.min(Math.max(1, opts.limit ?? MAX_CONFLICT_LIMIT), MAX_CONFLICT_LIMIT);
  const data = await client.judge({ limit });
  return { mode, data };
}

export async function resolveWorkspaceConflict(
  workspaceId: string,
  relationId: string,
  input: ResolveConflictInput
): Promise<{ mode: MnemoMode; data: ResolveConflictResponse | null }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  try {
    const data = await client.resolveConflict(relationId, input);
    return { mode, data };
  } catch (e) {
    const { MnemosyneAPIError } = await import("@mnemo-ai/client-ts");
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }
}
