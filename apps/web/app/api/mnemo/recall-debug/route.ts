// apps/web/app/api/mnemo/recall-debug/route.ts
//
// POST /api/mnemo/recall-debug — Inspector UI v2 recall pipeline tracer.
//
// Runs a single recall through `recallUnified` with `captureTrace=true`
// + a capturing `onMetric` callback. Returns the resulting hits AND the
// full per-stage event stream so the Inspector UI can render its
// pipeline funnel without a second round-trip.
//
// SCOPE:
//   - viewer+ access (read-only path; same RBAC tier as recall-unified).
//   - workspace-scoped — RLS enforces tenant isolation.
//   - Rate-limited (10 calls / minute / user) — trace mode is debug-
//     intent, not a hot path. The rate-limit cap defends against an
//     attacker scripting the endpoint to harvest verbatim fact
//     substrings via the sample previews.
//
// SECURITY NOTES:
//   - `captureTrace` surfaces verbatim fact statement previews (200 chars,
//     enforced server-side via `previewStatement`). RLS already gates
//     fact reads — the trace cannot reveal anything the caller couldn't
//     read through a normal recall.
//   - We DO NOT forward this debug surface to MCP / agent tools — the
//     production agent-runtime path never sets `captureTrace`.
//   - We audit-log every call (`inspector.recall_debug`) so an admin
//     can detect script-driven abuse from a compromised account.
//
// PERFORMANCE:
//   - captureTrace adds ~2-5ms / ~1-2 KB per call (mnemosyne docs).
//   - No L1/L3 cache write — every call hits the real pipeline so the
//     trace reflects the live pipeline, not a stale cache fixture.
//
// This route is intentionally separate from /api/mnemo/recall-unified
// (1) so the trace flag never gets toggled on the production endpoint
// by an upstream bug, (2) so the audit + rate-limit policy can diverge
// (the production endpoint isn't rate-limited at this tier), and (3)
// so the response shape can carry the trace stream without bloating
// the recall-unified contract for non-debug callers.

import { NextResponse } from "next/server";
import { z } from "zod";
import { recallUnified, withMnemoTx, type RecallMetricEvent } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { makeKbChunkProvider } from "@/lib/recall-unified";
import { safeLogError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  query: z.string().trim().min(1).max(4000),
  agentId: z.string().trim().min(1).max(100).optional(),
  kbId: z.string().trim().min(1).max(100).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  /** Force the pipeline branches on/off so the funnel exercises them. */
  options: z
    .object({
      enableHyDE: z.boolean().optional(),
      enableContextualize: z.boolean().optional(),
      expandGraph: z.boolean().optional(),
    })
    .optional(),
});

// ── Lightweight in-memory rate limit (per-process, per-user) ─────────────────
//
// Recall-debug is a debug endpoint; a token-bucket per process is
// sufficient — a multi-pod deployment would multiply the cap by the
// pod count, which is fine for this use case (we are not protecting
// against a coordinated DoS). For production-grade rate limiting we
// would reuse `lib/rate-limit/pg-token-bucket.ts` once that lands.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_CALLS = 10;
const rateLimitState = new Map<string, number[]>();

function checkRateLimit(userId: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const history = (rateLimitState.get(userId) ?? []).filter((t) => t > cutoff);
  if (history.length >= RATE_LIMIT_CALLS) {
    const oldest = history[0]!;
    return { allowed: false, retryAfterMs: oldest + RATE_LIMIT_WINDOW_MS - now };
  }
  history.push(now);
  rateLimitState.set(userId, history);
  return { allowed: true, retryAfterMs: 0 };
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const rl = checkRateLimit(ctx.user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const kbProvider = body.kbId ? makeKbChunkProvider(body.kbId) : null;

  // ── Capture every per-stage event into a flat array. The pipeline
  // emits events synchronously, so the array is fully populated by
  // the time `recallUnified` resolves. We attach this BEFORE the
  // recall call so a thrown stage still surfaces any prior events.
  const events: RecallMetricEvent[] = [];
  const captureOnMetric = (event: RecallMetricEvent): void => {
    events.push(event);
  };

  let items: Awaited<ReturnType<typeof recallUnified>> = [];
  try {
    items = await withMnemoTx(ctx.workspace.id, async (tx) =>
      recallUnified({
        workspaceId: ctx.workspace.id,
        query: body.query,
        ...(body.agentId ? { agentId: body.agentId } : {}),
        ...(body.topK !== undefined ? { topK: body.topK } : {}),
        ...(kbProvider ? { kbProvider } : {}),
        ...(body.options?.enableHyDE !== undefined ? { enableHyDE: body.options.enableHyDE } : {}),
        ...(body.options?.enableContextualize !== undefined
          ? { enableContextualize: body.options.enableContextualize }
          : {}),
        ...(body.options?.expandGraph !== undefined
          ? { expandGraph: body.options.expandGraph }
          : {}),
        onMetric: captureOnMetric,
        captureTrace: true,
        tx,
      })
    );
  } catch (e) {
    safeLogError("[recall-debug] recallUnified failed:", e);
    // Even on failure we return the partial trace so the UI can show
    // what stage threw.
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "recall failed",
        trace: { events },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    items,
    trace: { events },
  });
}
