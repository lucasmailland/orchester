// apps/web/lib/mnemo/decisions.ts
//
// HTTP-only wrappers for the decision-lineage surface.
//   - listWorkspaceDecisions     → GET   /decisions
//   - supersedeWorkspaceDecision → PATCH /decisions/:id  (+ supersedes edge)
//
// supersedeDecision (client.ts:789-800) flips status to 'superseded' and sets
// supersededById, but does NOT create the matching `supersedes` relation —
// the SDK doc explicitly says the caller owns that. So after a successful
// supersede we also create a decision→decision `supersedes` relation so the
// lineage shows up as a graph edge. Edge-creation failure is non-fatal (the
// decision state already changed); we surface it via `edgeCreated`.
import "server-only";
import type { ListDecisionsResponse, MnemoDecision } from "@mnemo-ai/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

export { getMnemoMode };
export type { MnemoMode };

export async function listWorkspaceDecisions(
  workspaceId: string,
  opts: { status?: "active" | "superseded" | "withdrawn"; limit: number }
): Promise<{ mode: MnemoMode; data: ListDecisionsResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  const data = await client.listDecisions({
    ...(opts.status ? { status: opts.status } : {}),
    limit: opts.limit,
  });
  return { mode, data };
}

export async function supersedeWorkspaceDecision(
  workspaceId: string,
  id: string,
  supersededById: string,
  markedByUserId: string
): Promise<{ mode: MnemoMode; data: MnemoDecision | null; edgeCreated: boolean }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  const { MnemosyneAPIError } = await import("@mnemo-ai/client-ts");

  let data: MnemoDecision;
  try {
    data = await client.supersedeDecision(id, { supersededById });
  } catch (e) {
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null, edgeCreated: false };
    }
    throw e;
  }

  // Lineage edge: the NEW decision `supersedes` the OLD one. source=new,
  // target=old, verb=supersedes (one of the 9 LOCKED verbs).
  let edgeCreated = false;
  try {
    await client.createRelation({
      sourceKind: "decision",
      sourceId: supersededById,
      targetKind: "decision",
      targetId: id,
      relation: "supersedes",
      judgmentStatus: "judged",
      markedByKind: "user",
      markedByUserId,
    });
    edgeCreated = true;
  } catch (e) {
    // Non-fatal: the decision is already superseded. Log + report.
    console.error("[mnemo/decisions] lineage edge create failed", e);
  }

  return { mode, data, edgeCreated };
}
