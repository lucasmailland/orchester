// apps/web/app/api/mnemo/export/route.ts
//
// GET /api/mnemo/export — full JSON dump of a workspace's Mnemosyne
// memory. Includes facts, decisions, relations, citations. EXCLUDES
// embedding vectors (heavy — they'd dominate the payload and the
// receiving system can re-embed if it wants).
//
// Streaming is the v1.4 polish; v1.3 returns a single buffered JSON
// response with a `Content-Disposition: attachment` header so the
// browser saves it as a file. Capped at 100 000 rows per resource
// (sane default for current workspaces; the rare large workspace
// can wait for streaming).
//
// RBAC: admin+. Reading every workspace fact is an export-scope
// action, not an editor-scope one.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ROW_CAP_PER_RESOURCE = 100_000;

export async function GET() {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  // Single workspace-scoped tx so the four reads see a consistent
  // snapshot. The cap is enforced server-side via LIMIT — we do NOT
  // surface "more available" in the response body for v1.3; large
  // workspaces will get a streaming endpoint in v1.4.
  const payload = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const facts = (await tx.execute(sql`
      SELECT id, agent_id, scope, scope_ref, kind, subject, statement,
             confidence, pinned, relevance, hit_count, last_recalled_at,
             source_message_ids, attributed_to, linked_memory_ids,
             metadata, status, merged_into_id, valid_from, valid_to,
             created_at, updated_at
      FROM mnemo_fact
      WHERE workspace_id = ${ctx.workspace.id}
      ORDER BY created_at ASC
      LIMIT ${ROW_CAP_PER_RESOURCE}
    `)) as unknown as Array<Record<string, unknown>>;

    const decisions = (await tx.execute(sql`
      SELECT id, agent_id, conversation_id, kind, title, body, topic_key,
             revision_count, normalized_hash, decided_by_user_id,
             status, superseded_by_id, metadata, valid_from, valid_to,
             created_at, updated_at
      FROM mnemo_decision
      WHERE workspace_id = ${ctx.workspace.id}
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
      WHERE workspace_id = ${ctx.workspace.id}
      ORDER BY created_at ASC
      LIMIT ${ROW_CAP_PER_RESOURCE}
    `)) as unknown as Array<Record<string, unknown>>;

    const citations = (await tx.execute(sql`
      SELECT id, memory_kind, memory_id, source_kind, source_id,
             extractor_model, extractor_prompt_version, judge_model,
             judge_relation_id, evidence_excerpt, created_at
      FROM mnemo_citation
      WHERE workspace_id = ${ctx.workspace.id}
      ORDER BY created_at ASC
      LIMIT ${ROW_CAP_PER_RESOURCE}
    `)) as unknown as Array<Record<string, unknown>>;

    return { facts, decisions, relations, citations };
  });

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.export",
    resource: "workspace",
    resourceId: ctx.workspace.id,
    after: {
      factCount: payload.facts.length,
      decisionCount: payload.decisions.length,
      relationCount: payload.relations.length,
      citationCount: payload.citations.length,
    },
  });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `mnemo-export-${ctx.workspace.slug}-${ts}.json`;

  return new NextResponse(
    JSON.stringify(
      {
        meta: {
          workspaceId: ctx.workspace.id,
          workspaceSlug: ctx.workspace.slug,
          exportedAt: new Date().toISOString(),
          exportedBy: ctx.user.id,
          rowCapPerResource: ROW_CAP_PER_RESOURCE,
          embeddingsExcluded: true,
        },
        ...payload,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    }
  );
}
