// apps/web/lib/mnemo/export.ts
//
// Dual-mode implementation of the workspace memory export. Mirrors
// the other helpers under lib/mnemo/: pick HTTP (service mode) vs
// in-process (library mode) at runtime via `MNEMO_URL` + `MNEMO_API_KEY`.
//
// One helper covers GET /api/mnemo/export. Returns the raw 4-table
// payload (facts/decisions/relations/citations) so the route handler
// can decorate it with the `meta` block + Content-Disposition for
// download. Both modes return identical row shapes (snake_case
// columns from the underlying SELECTs); embeddings are excluded.

import "server-only";

export type MnemoMode = "service" | "library";

export function getMnemoMode(): MnemoMode {
  return process.env["MNEMO_URL"] && process.env["MNEMO_API_KEY"] ? "service" : "library";
}

export interface ExportPayload {
  facts: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
}

const ROW_CAP_PER_RESOURCE = 100_000;

export async function exportWorkspaceData(
  workspaceId: string
): Promise<{ mode: MnemoMode; data: ExportPayload }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    const resp = await client.exportWorkspace();
    return {
      mode,
      data: {
        facts: resp.facts,
        decisions: resp.decisions,
        relations: resp.relations,
        citations: resp.citations,
      },
    };
  }

  // Library path mirrors the legacy export route's logic verbatim:
  // single workspace-scoped tx, four reads, 100k cap per resource,
  // embeddings excluded. Hand-rolled SQL because the helpers in
  // @mnemosyne/core don't ship "dump everything" SELECTs and the
  // column projections are slightly different from what the inspector
  // CRUD reads use.
  const { withMnemoTx } = await import("@mnemosyne/core");
  const { sql } = await import("drizzle-orm");
  const data = await withMnemoTx(workspaceId, async (tx) => {
    const facts = (await tx.execute(sql`
      SELECT id, agent_id, scope, scope_ref, kind, subject, statement,
             confidence, pinned, relevance, hit_count, last_recalled_at,
             source_message_ids, attributed_to, linked_memory_ids,
             metadata, status, merged_into_id, valid_from, valid_to,
             created_at, updated_at
      FROM mnemo_fact
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at ASC
      LIMIT ${ROW_CAP_PER_RESOURCE}
    `)) as unknown as Array<Record<string, unknown>>;

    const decisions = (await tx.execute(sql`
      SELECT id, agent_id, conversation_id, kind, title, body, topic_key,
             revision_count, normalized_hash, decided_by_user_id,
             status, superseded_by_id, metadata, valid_from, valid_to,
             created_at, updated_at
      FROM mnemo_decision
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at ASC
      LIMIT ${ROW_CAP_PER_RESOURCE}
    `)) as unknown as Array<Record<string, unknown>>;

    const relations = (await tx.execute(sql`
      SELECT id, source_kind, source_id, target_kind, target_id,
             relation, judgment_status, reason, evidence, confidence,
             marked_by_user_id, marked_by_kind, marked_by_model,
             marked_by_prompt_version, conversation_id,
             superseded_by_relation_id, valid_from, valid_to,
             created_at, updated_at
      FROM mnemo_relation
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at ASC
      LIMIT ${ROW_CAP_PER_RESOURCE}
    `)) as unknown as Array<Record<string, unknown>>;

    const citations = (await tx.execute(sql`
      SELECT id, memory_kind, memory_id, source_kind, source_id,
             extractor_model, extractor_prompt_version, judge_model,
             judge_relation_id, evidence_excerpt, created_at
      FROM mnemo_citation
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at ASC
      LIMIT ${ROW_CAP_PER_RESOURCE}
    `)) as unknown as Array<Record<string, unknown>>;

    return { facts, decisions, relations, citations };
  });

  return { mode, data };
}
