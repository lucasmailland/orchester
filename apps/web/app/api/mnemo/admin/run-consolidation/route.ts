// apps/web/app/api/mnemo/admin/run-consolidation/route.ts
//
// POST /api/mnemo/admin/run-consolidation
//
// Triggers an on-demand REM consolidation pass via the
// @mnemosyne/client-ts SDK. This is the only admin housekeeping
// operation that the SDK exposes as a direct trigger endpoint
// (`POST /v1/consolidation/trigger`).
//
// Returns `{ enqueued: true, ...sdkResult }` on success. On SDK
// failure returns 502 with `{ error: "<message>" }` — the client-side
// MemoryOpsClient displays this in an error toast.
//
// RBAC: admin — same gating as other destructive admin surfaces.
import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { getMnemoClient } from "@/lib/mnemo/client";
import { safeLogError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).loose();

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const client = getMnemoClient();
    const result = await client.triggerConsolidation({ mode: "fast" });
    return NextResponse.json({ enqueued: true, ...result });
  } catch (e) {
    safeLogError("[mnemo/admin/run-consolidation] SDK call failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
