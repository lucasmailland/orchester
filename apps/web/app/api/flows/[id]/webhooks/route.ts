import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { createFlowWebhook, listFlowWebhooks, serviceErrorResponse } from "@/lib/flows/service";

const createFlowWebhookSchema = z.object({
  hmac: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  try {
    // Not redacted: the editor shows the secrets.
    const rows = await listFlowWebhooks(
      { kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id },
      id
    );
    return NextResponse.json(rows);
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, createFlowWebhookSchema);
  if (!parsed.ok) return parsed.response;
  try {
    // The service checks that the flow belongs to the caller's workspace.
    const row = await createFlowWebhook(
      { kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id },
      id,
      { hmac: Boolean(parsed.data.hmac) }
    );
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    return serviceErrorResponse(e);
  }
}
