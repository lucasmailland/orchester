// apps/web/app/api/mnemo/admin/run-health/route.ts
//
// POST /api/mnemo/admin/run-health
//
// Reads the current health snapshot from the @mnemosyne/server SDK.
// There is no "trigger a health capture" endpoint in the SDK — the
// server captures snapshots on its own schedule. This route returns
// the live snapshot so the UI button at least reflects current state
// rather than 404ing.
//
// Returns `{ enqueued: true, snapshot: <HealthSnapshot> }` on success.
// On SDK failure returns 502 with `{ error: "<message>" }`.
//
// RBAC: admin — consistent with the other run-* endpoints.
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
    const snapshot = await client.health();
    return NextResponse.json({ enqueued: true, snapshot });
  } catch (e) {
    safeLogError("[mnemo/admin/run-health] SDK call failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
