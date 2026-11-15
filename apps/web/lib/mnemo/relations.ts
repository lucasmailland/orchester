// apps/web/lib/mnemo/relations.ts
//
// HTTP-only wrappers for the workspace's relation-curation surface.
//   - listWorkspaceRelations  → GET  /relations?judgmentStatus=pending
//   - patchWorkspaceRelation  → PATCH /relations/:id  (apply a judgment)
//   - createWorkspaceRelation → POST  /relations       (manual edge draw)
//
// Every helper returns the discriminated `{ mode, data }` envelope so the
// route handler can stamp X-Mnemo-Mode. patch returns data:null on 404 so
// the route can map → 404 (mirrors lib/mnemo/review.ts:57-80).
import "server-only";
import type {
  CreateRelationInput,
  ListRelationsResponse,
  MnemoRelation,
  PatchRelationInput,
} from "@mnemo-ai/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

export { getMnemoMode };
export type { MnemoMode };

export async function listWorkspaceRelations(
  workspaceId: string,
  opts: { judgmentStatus?: "pending" | "judged" | "dismissed"; limit: number }
): Promise<{ mode: MnemoMode; data: ListRelationsResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  const data = await client.listRelations({
    ...(opts.judgmentStatus ? { judgmentStatus: opts.judgmentStatus } : {}),
    limit: opts.limit,
  });
  return { mode, data };
}

export async function patchWorkspaceRelation(
  workspaceId: string,
  id: string,
  input: PatchRelationInput
): Promise<{ mode: MnemoMode; data: MnemoRelation | null }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  try {
    const data = await client.patchRelation(id, input);
    return { mode, data };
  } catch (e) {
    const { MnemosyneAPIError } = await import("@mnemo-ai/client-ts");
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }
}

export async function createWorkspaceRelation(
  workspaceId: string,
  input: CreateRelationInput
): Promise<{ mode: MnemoMode; data: MnemoRelation }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  const data = await client.createRelation(input);
  return { mode, data };
}
