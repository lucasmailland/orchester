import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { encrypt, maskKey, decrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";
import { parseBody } from "@/lib/validation";

const connectProviderSchema = z.object({
  provider: z.string().min(1, "provider and apiKey required"),
  apiKey: z.string().min(1, "provider and apiKey required"),
  endpoint: z.string().optional(),
});

function safeDecrypt(s: string): string {
  try {
    return decrypt(s);
  } catch {
    return "";
  }
}

/** En self-host con ANTHROPIC_API_KEY/OPENAI_API_KEY/GOOGLE_AI_API_KEY en .env,
 * tratamos esos providers como configurados aunque no haya filas en DB. */
function envFallbackProviders(): Array<{ provider: string; source: "env" }> {
  const out: Array<{ provider: string; source: "env" }> = [];
  if (process.env["ANTHROPIC_API_KEY"]) out.push({ provider: "anthropic", source: "env" });
  if (process.env["OPENAI_API_KEY"]) out.push({ provider: "openai", source: "env" });
  if (process.env["GOOGLE_AI_API_KEY"]) out.push({ provider: "google", source: "env" });
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const isSummary = url.searchParams.get("summary") === "1";

  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      const rows = await tx
        .select()
        .from(schema.aiProviders)
        .where(eq(schema.aiProviders.workspaceId, ctx.workspace.id));
      const dbProviders = rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        apiKeyMasked: maskKey(safeDecrypt(r.apiKey)),
        endpoint: r.endpoint,
        enabled: r.enabled,
        models: r.modelsJson ?? [],
        lastTestedAt: r.lastTestedAt,
        lastTestStatus: r.lastTestStatus,
        lastTestError: r.lastTestError,
        source: "db" as const,
      }));

      // ?summary=1 → forma compacta usada por NoProviderBanner.
      if (isSummary) {
        const envProvs = envFallbackProviders();
        // ¿Existe al menos un mensaje histórico? Si la cuenta tiene actividad y
        // ningún provider activo, el banner debe gritar más fuerte.
        const msg = await tx
          .select({ id: schema.messages.id })
          .from(schema.messages)
          .innerJoin(
            schema.conversations,
            eq(schema.messages.conversationId, schema.conversations.id)
          )
          .where(eq(schema.conversations.workspaceId, ctx.workspace.id))
          .limit(1);
        const configured = dbProviders.length > 0 || envProvs.length > 0;
        return {
          summary: {
            configured,
            sources: [
              ...dbProviders.map((p) => ({ provider: p.provider, source: "db" })),
              ...envProvs,
            ],
            hasHistoricalActivity: msg.length > 0,
          },
        };
      }

      return { providers: dbProviders };
    },
  });
  if (result instanceof Response) return result;
  if ("summary" in result) return NextResponse.json(result.summary);
  return NextResponse.json(result.providers);
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, connectProviderSchema);
  if (!parsed.ok) return parsed.response;
  const { provider, apiKey, endpoint } = parsed.data;
  if (!apiKey.trim())
    return NextResponse.json({ error: "provider and apiKey required" }, { status: 400 });

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, user, tx }) => {
      const existing = await tx
        .select()
        .from(schema.aiProviders)
        .where(
          and(
            eq(schema.aiProviders.workspaceId, ctx.workspace.id),
            eq(schema.aiProviders.provider, provider)
          )
        )
        .limit(1);

      const ciphertext = encrypt(apiKey.trim());
      if (existing[0]) {
        const updated = await tx
          .update(schema.aiProviders)
          .set({ apiKey: ciphertext, endpoint: endpoint ?? null, updatedAt: new Date() })
          .where(eq(schema.aiProviders.id, existing[0].id))
          .returning();
        const row = updated[0];
        if (!row) return { _err: "Update failed", _status: 500 };
        // No loguear la key, sólo el provider y el masked.
        await logAudit({
          workspaceId: ctx.workspace.id,
          userId: user.id,
          action: "provider.update",
          resource: "ai_provider",
          resourceId: row.id,
          after: { provider: row.provider, apiKeyMasked: maskKey(apiKey.trim()) },
        });
        return { result: { id: row.id, provider: row.provider }, isNew: false };
      }
      const inserted = await tx
        .insert(schema.aiProviders)
        .values({
          id: createId(),
          workspaceId: ctx.workspace.id,
          provider,
          apiKey: ciphertext,
          endpoint: endpoint ?? null,
        })
        .returning();
      const row = inserted[0];
      if (!row) return { _err: "Insert failed", _status: 500 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "provider.create",
        resource: "ai_provider",
        resourceId: row.id,
        after: { provider: row.provider, apiKeyMasked: maskKey(apiKey.trim()) },
      });
      return { result: { id: row.id, provider: row.provider }, isNew: true };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.result, { status: result.isNew ? 201 : 200 });
}
