// apps/web/app/api/admin/mnemo-seed/route.ts
//
// v1.6 G1-6: dev-only admin endpoint that seeds synthetic
// `mnemo_fact` rows for the Memory Inspector smoke test.
//
// Gated:
//   - admin role required (same as other /api/admin routes)
//   - NODE_ENV !== 'production' OR env flag MNEMO_SEED_ENABLED=true
//
// Body: { count?: number, agentId?: string | null }
// Returns: SeedMnemoResult (see lib/dev-seed/mnemo-seed.ts).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { seedMnemoFacts } from "@/lib/dev-seed/mnemo-seed";

const seedSchema = z.object({
  count: z.number().int().min(1).max(200).optional(),
  agentId: z.string().nullable().optional(),
});

function isEnabled(): boolean {
  if (process.env["NODE_ENV"] !== "production") return true;
  return process.env["MNEMO_SEED_ENABLED"] === "true";
}

export async function POST(req: Request) {
  if (!isEnabled()) {
    return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  }
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const parsed = await parseBody(req, seedSchema);
  if (!parsed.ok) return parsed.response;

  const result = await seedMnemoFacts({
    workspaceId: ctx.workspace.id,
    agentId: parsed.data.agentId ?? null,
    count: parsed.data.count ?? 30,
  });

  return NextResponse.json(result);
}
