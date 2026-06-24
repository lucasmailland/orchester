// apps/web/app/api/mnemo/admin/run-auto-pin/route.ts
//
// POST /api/mnemo/admin/run-auto-pin
//
// Auto-pinning is scheduled internally by @mnemosyne/server's own cron
// infrastructure (mnemo_cron_schedule). The @mnemosyne/client-ts SDK
// does not expose an on-demand trigger endpoint for this job.
//
// Returns 501 with a human-readable message so the MemoryOpsClient
// shows an error toast instead of a mysterious 404. When the SDK ships
// an auto-pin trigger, replace this stub with a real implementation.
//
// RBAC: admin — consistent with the other run-* endpoints.
import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).loose();

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json(
    {
      error:
        "Auto-pin is scheduled by @mnemosyne/server's internal cron. " +
        "On-demand triggering is not yet exposed via the HTTP API.",
    },
    { status: 501 }
  );
}
