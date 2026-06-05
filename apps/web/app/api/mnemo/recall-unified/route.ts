// apps/web/app/api/mnemo/recall-unified/route.ts
//
// POST /api/mnemo/recall-unified — v1.4 unified recall endpoint.
//
// Returns a blended top-K of facts + KB chunks for a single query.
// Mnemosyne handles the blending policy (memory weight 0.6, KB weight
// 0.4 by default); this route wires the host's KB provider against
// the existing `knowledge_chunk` table via `makeKbChunkProvider`.
//
// Body:
//   {
//     query: string,         // required
//     agentId?: string,      // optional — partitions memory recall
//     kbId?: string,         // optional — if absent, memory-only
//     topK?: number,         // default 5, [1, 20]
//     memoryWeight?: number, // default 0.6, [0, 1]
//     kbWeight?: number,     // default 0.4, [0, 1]
//     actorId?: string,      // optional — per-actor isolation (v1.4)
//   }
//
// RBAC: member+. Wrap in `withMnemoTx(workspaceId, ...)` so RLS FORCE
// allows the SELECT on `mnemo_fact`.
//
// Defensive LLM-cap wrapper: this route does NOT currently fire any
// LLM calls (HyDE is off by default; the reranker is the safe noop).
// The route is intentionally not wired to `prepareQueryLlm` or a
// Cohere reranker — those will land in a follow-up that pairs them
// with `assertWithinSpend` + `recordAiUsage`. The audit-invariants
// script enforces that pairing.
import { NextResponse } from "next/server";
import { z } from "zod";
import { recallUnified, withMnemoTx } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { makeKbChunkProvider } from "@/lib/recall-unified";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  query: z.string().trim().min(1).max(4000),
  agentId: z.string().trim().min(1).max(100).optional(),
  kbId: z.string().trim().min(1).max(100).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  memoryWeight: z.number().min(0).max(1).optional(),
  kbWeight: z.number().min(0).max(1).optional(),
  actorId: z.string().trim().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  // NOTE: brief specified minRole='member'; this codebase uses
  // 'viewer' | 'editor' | 'admin' | 'owner'. Mapping 'member' →
  // 'viewer' as the closest equivalent (read-only access matches the
  // recall surface's semantics: reading memory + KB without mutating).

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const kbProvider = body.kbId ? makeKbChunkProvider(body.kbId) : null;

  const items = await withMnemoTx(ctx.workspace.id, async (tx) =>
    recallUnified({
      workspaceId: ctx.workspace.id,
      query: body.query,
      ...(body.agentId ? { agentId: body.agentId } : {}),
      ...(body.actorId ? { actorId: body.actorId } : {}),
      ...(body.topK !== undefined ? { topK: body.topK } : {}),
      ...(body.memoryWeight !== undefined ? { memoryWeight: body.memoryWeight } : {}),
      ...(body.kbWeight !== undefined ? { kbWeight: body.kbWeight } : {}),
      ...(kbProvider ? { kbProvider } : {}),
      tx,
    })
  );

  return NextResponse.json({ items });
}
