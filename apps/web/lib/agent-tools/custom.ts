import "server-only";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { withWorkspaceTx } from "@/lib/tenant/context";

/** The workspace's own HTTP tools (agent_tool rows), for the agent tool picker. */
export async function listCustomTools(workspaceId: string) {
  const rows = await withWorkspaceTx(workspaceId, (tx) =>
    tx.select().from(schema.agentTools).where(eq(schema.agentTools.workspaceId, workspaceId))
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    label: r.name,
    emoji: "🔧",
    category: "Custom",
    builtin: false,
    kind: r.kind,
  }));
}
