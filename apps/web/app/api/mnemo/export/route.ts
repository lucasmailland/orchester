// apps/web/app/api/mnemo/export/route.ts
//
// GET /api/mnemo/export — full JSON dump of a workspace's Mnemosyne
// memory. Includes facts, decisions, relations, citations. EXCLUDES
// embedding vectors (heavy — they'd dominate the payload and the
// receiving system can re-embed if it wants).
//
// As of the service-extraction Phase 2 (tramo 3), the handler
// delegates to `exportWorkspaceData()` which picks the data source at
// runtime (service vs library). The response wrapping (meta block +
// Content-Disposition for browser download) stays on the orchester
// side so the file-name format reflects the workspace slug — slugs
// are an orchester concept that the upstream service doesn't know
// about.
//
// Streaming is the v1.4 polish; v1.3 returns a single buffered JSON
// response with a `Content-Disposition: attachment` header so the
// browser saves it as a file. Capped at 100 000 rows per resource
// (enforced upstream and in the helper's library branch).
//
// RBAC: admin+. Reading every workspace fact is an export-scope
// action, not an editor-scope one.
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { exportWorkspaceData } from "@/lib/mnemo/export";

export const dynamic = "force-dynamic";

const ROW_CAP_PER_RESOURCE = 100_000;

export async function GET() {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const { mode, data } = await exportWorkspaceData(ctx.workspace.id);

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.export",
    resource: "workspace",
    resourceId: ctx.workspace.id,
    after: {
      factCount: data.facts.length,
      decisionCount: data.decisions.length,
      relationCount: data.relations.length,
      citationCount: data.citations.length,
    },
  });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `mnemo-export-${ctx.workspace.slug}-${ts}.json`;

  // We re-marshal the body here (rather than passing data through)
  // so the `meta` block carries orchester-side concepts (workspace
  // slug, exportedBy user id) the upstream service can't know about.
  // The four data arrays are passed through verbatim — they're
  // schema-identical between modes.
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
        ...data,
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
        "X-Mnemo-Mode": mode,
      },
    }
  );
}
