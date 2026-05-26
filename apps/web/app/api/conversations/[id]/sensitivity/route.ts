// apps/web/app/api/conversations/[id]/sensitivity/route.ts
//
// Mnemosyne v1.5 F1 — toggle the per-conversation memory sensitivity
// gate. PATCH `{ paused: boolean }` flips
// `conversation.memory_learning_paused` for the conversation, which
// the brain extract-job consults on every run BEFORE the LLM call.
//
// Editor+ RBAC because flipping the gate has direct memory-pipeline
// consequences (no facts written for paused conversations). Body is
// zod-validated. The DB update runs inside a workspace-scoped tx so
// RLS+FORCE sees `app.workspace_id` SET LOCAL — same pattern as
// `/api/conversations/[id]/takeover/route.ts`.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

const sensitivitySchema = z.object({
  paused: z.boolean(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const parsed = await parseBody(req, sensitivitySchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await params;
  const db = getDb();

  const updated = await db.transaction(async (tx) => {
    // Workspace GUC so RLS+FORCE on `conversation` matches the editor's
    // workspace. Mirrors takeover/route.ts.
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .update(schema.conversations)
      .set({ memoryLearningPaused: parsed.data.paused })
      .where(
        and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspace.id))
      )
      .returning({
        id: schema.conversations.id,
        memoryLearningPaused: schema.conversations.memoryLearningPaused,
      });
  });

  const row = updated[0];
  if (!row) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Audit log — this is a privacy / memory-pipeline decision, surface
  // it on the chain so admins can prove who flipped the flag when.
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: parsed.data.paused
      ? "conversation.memory_learning_paused"
      : "conversation.memory_learning_resumed",
    resource: "conversation",
    resourceId: id,
  });

  return NextResponse.json({
    id: row.id,
    memoryLearningPaused: row.memoryLearningPaused,
  });
}
