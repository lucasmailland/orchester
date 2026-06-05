// apps/web/lib/mnemo/episodes.ts
//
// Dual-mode implementation of the workspace's episode timeline
// surface. Mirrors `lib/mnemo/entities.ts` and `lib/mnemo/graph.ts`:
// pick HTTP (service mode) vs in-process (library mode) at runtime
// via `MNEMO_URL` + `MNEMO_API_KEY`.
//
// Two helpers cover the read endpoints under /v1/episodes:
//   - listWorkspaceEpisodes  → GET /api/mnemo/episodes
//   - getWorkspaceEpisode    → GET /api/mnemo/episodes/[id]
//
// Both return a discriminated `{ mode, data }` envelope so the caller
// can stamp `X-Mnemo-Mode` on the response. Wire shape is the SDK
// shape (ISO strings) regardless of mode — library Date fields are
// collapsed to strings at the helper boundary.

import "server-only";
import type {
  EpisodeWithLinkedFacts,
  ListEpisodesResponse,
  MemoryFact,
  MnemoEpisode,
} from "@mnemosyne/client-ts";

export type MnemoMode = "service" | "library";

export function getMnemoMode(): MnemoMode {
  return process.env["MNEMO_URL"] && process.env["MNEMO_API_KEY"] ? "service" : "library";
}

function episodeRowToWire(e: {
  id: string;
  workspaceId: string;
  title: string;
  narrative: string;
  occurredAt: Date;
  durationMinutes: number | null;
  participants: string[];
  topics: string[];
  linkedFactIds: string[];
  sourceConversationId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  isSynthetic: boolean;
}): MnemoEpisode {
  return {
    id: e.id,
    workspaceId: e.workspaceId,
    title: e.title,
    narrative: e.narrative,
    occurredAt: e.occurredAt.toISOString(),
    durationMinutes: e.durationMinutes,
    participants: e.participants,
    topics: e.topics,
    linkedFactIds: e.linkedFactIds,
    sourceConversationId: e.sourceConversationId,
    metadata: e.metadata,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    isSynthetic: e.isSynthetic,
  };
}

function factRowToWire(f: {
  id: string;
  workspaceId: string;
  agentId: string | null;
  scope: "global" | "conversation" | "employee" | "team";
  scopeRef: string | null;
  kind: "preference" | "trait" | "event" | "relationship" | "skill" | "concern" | "other";
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  relevance: number;
  hitCount: number;
  lastRecalledAt: Date | null;
  sourceMessageIds: string[];
  attributedTo: "user" | "assistant" | "system" | null;
  linkedMemoryIds: string[];
  metadata: Record<string, unknown>;
  status: "active" | "merged" | "forgotten";
  mergedIntoId: string | null;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
  memoryType?: "semantic" | "episodic" | "procedural" | "working";
  actorId?: string | null;
}): MemoryFact {
  const wire: MemoryFact = {
    id: f.id,
    workspaceId: f.workspaceId,
    agentId: f.agentId,
    scope: f.scope,
    scopeRef: f.scopeRef,
    kind: f.kind,
    subject: f.subject,
    statement: f.statement,
    confidence: f.confidence,
    pinned: f.pinned,
    relevance: f.relevance,
    hitCount: f.hitCount,
    lastRecalledAt: f.lastRecalledAt ? f.lastRecalledAt.toISOString() : null,
    sourceMessageIds: f.sourceMessageIds,
    attributedTo: f.attributedTo,
    linkedMemoryIds: f.linkedMemoryIds,
    metadata: f.metadata,
    status: f.status,
    mergedIntoId: f.mergedIntoId,
    validFrom: f.validFrom.toISOString(),
    validTo: f.validTo ? f.validTo.toISOString() : null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
  if (f.memoryType !== undefined) wire.memoryType = f.memoryType;
  if (f.actorId !== undefined) wire.actorId = f.actorId;
  return wire;
}

export async function listWorkspaceEpisodes(
  workspaceId: string,
  opts: { from?: Date; to?: Date; topic?: string; limit: number; includeSynthetic?: boolean }
): Promise<{ mode: MnemoMode; data: ListEpisodesResponse }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    const data = await client.listEpisodes({
      ...(opts.from ? { from: opts.from.toISOString() } : {}),
      ...(opts.to ? { to: opts.to.toISOString() } : {}),
      ...(opts.topic ? { topic: opts.topic } : {}),
      limit: opts.limit,
      ...(opts.includeSynthetic !== undefined ? { includeSynthetic: opts.includeSynthetic } : {}),
    });
    return { mode, data };
  }

  const { listEpisodes, withMnemoTx } = await import("@mnemosyne/core");
  const items = await withMnemoTx(workspaceId, (tx) =>
    listEpisodes({
      workspaceId,
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
      ...(opts.topic ? { topic: opts.topic } : {}),
      limit: opts.limit,
      ...(opts.includeSynthetic !== undefined ? { includeSynthetic: opts.includeSynthetic } : {}),
      tx,
    })
  );
  return { mode, data: { items: items.map(episodeRowToWire) } };
}

export async function getWorkspaceEpisode(
  workspaceId: string,
  id: string
): Promise<{ mode: MnemoMode; data: EpisodeWithLinkedFacts | null }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    try {
      const data = await client.getEpisode(id);
      return { mode, data };
    } catch (e) {
      const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  // Library path mirrors the original /api/mnemo/episodes/[id] route's
  // logic verbatim: getEpisode + an `inArray` batch lookup for the
  // linked facts. Some linked-fact ids may point at since-archived
  // rows; those are silently filtered (an episode legitimately
  // outlives some of its constituent facts).
  const { getEpisode, withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { inArray } = await import("drizzle-orm");
  const result = await withMnemoTx(workspaceId, async (tx) => {
    const episode = await getEpisode(workspaceId, id, tx);
    if (!episode) return null;
    let rawFacts: unknown[] = [];
    if (episode.linkedFactIds.length > 0) {
      rawFacts = await tx
        .select()
        .from(schema.mnemoFacts)
        .where(inArray(schema.mnemoFacts.id, episode.linkedFactIds));
    }
    // The raw rows from drizzle here come back with the column names
    // mapped to the schema's camelCase property names — same shape as
    // factRowToWire expects.
    return {
      episode: episodeRowToWire(episode),
      linkedFacts: (rawFacts as Parameters<typeof factRowToWire>[0][]).map(factRowToWire),
    };
  });
  return { mode, data: result };
}
