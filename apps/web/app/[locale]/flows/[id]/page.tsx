import { notFound, redirect } from "next/navigation";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { FlowBuilder } from "@/components/flows/FlowBuilder";

export default async function FlowDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const ws = await getCurrentWorkspace();
  if (!ws) redirect(`/${locale}/login`);
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flows)
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws.workspace.id)))
    .limit(1);
  const f = rows[0];
  if (!f) notFound();
  return (
    <FlowBuilder
      flow={{
        id: f.id,
        name: f.name,
        nodes: (f.nodes ?? []) as never,
        edges: (f.edges ?? []) as never,
        variables: (f.variables ?? {}) as Record<string, unknown>,
      }}
    />
  );
}
