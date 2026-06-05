// packages/mnemosyne/src/graph/query.ts
// Memory Graph DB query. Two entry points:
//   buildGraphData  — pure transform (testable without DB)
//   buildGraphQuery — fetches from DB then calls buildGraphData

import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";
import type {
  GraphNode,
  GraphEdge,
  GraphResponse,
  GraphQueryOptions,
  GraphEntityKind,
} from "./types";

// `buildGraphData` only reads a fixed subset of columns off each raw DB row.
// We type its parameters with the minimal structural shape (Pick<…>) rather
// than the full Drizzle `$inferSelect` rows so the pure function stays easy to
// exercise with hand-written fixtures in unit tests. `buildGraphQuery` (below)
// remains fully typed against the real schema and feeds those rows in — they
// satisfy these picks structurally.
type EntityRow = Pick<
  typeof schema.mnemoEntity.$inferSelect,
  "id" | "name" | "description" | "mentionCount" | "canonicalId" | "createdAt"
> & {
  // Loosened from the Drizzle enum literal union to plain `string` so the
  // pure transform accepts hand-written fixtures (and any host whose entity
  // `kind` vocabulary differs). `buildGraphQuery` still feeds in the strict
  // schema rows, which satisfy `string` structurally.
  kind: string;
};
type EpisodeRow = Pick<
  typeof schema.mnemoEpisode.$inferSelect,
  "id" | "title" | "linkedFactIds" | "createdAt"
>;
type DecisionRow = Pick<typeof schema.mnemoDecisions.$inferSelect, "id" | "title" | "createdAt">;
type RelationRow = Pick<
  typeof schema.mnemoRelations.$inferSelect,
  "id" | "sourceId" | "targetId" | "confidence" | "provenance"
> & {
  // Loosened from the locked RELATION_VERBS literal union to plain `string`
  // so fixtures and non-Drizzle hosts can pass relation verbs without the
  // const-assertion. The strict schema rows still satisfy `string`.
  relation: string;
};
type FactStat = { entityId: string | null; factCount: number; avgMemoryStrength: number };

export function buildGraphData(
  entities: EntityRow[],
  episodes: EpisodeRow[],
  decisions: DecisionRow[],
  factStats: FactStat[],
  relations: RelationRow[],
  opts: GraphQueryOptions
): GraphResponse {
  const factStatsMap = new Map(
    factStats.filter((s) => s.entityId != null).map((s) => [s.entityId!, s])
  );

  // avgMemoryStrength baseline note: an entity/episode/decision with no linked
  // facts gets 1.0, not 0. 1.0 is Mnemosyne's neutral potentiation baseline
  // (a fresh fact starts at 1.0), so a node with no facts renders with the same
  // faint aura as a brand-new memory rather than vanishing. The aura formula in
  // node-canvas scales strength/5.0, so 1.0 ≈ a barely-there glow.
  const entityNodes: GraphNode[] = entities
    .filter((e) => e.canonicalId == null)
    .map((e) => ({
      id: e.id,
      kind: "entity" as const,
      entityKind: e.kind as GraphEntityKind,
      label: e.name,
      description: e.description,
      mentionCount: e.mentionCount,
      factCount: factStatsMap.get(e.id)?.factCount ?? 0,
      avgMemoryStrength: factStatsMap.get(e.id)?.avgMemoryStrength ?? 1.0,
      createdAt: e.createdAt.toISOString(),
    }));

  const episodeNodes: GraphNode[] = episodes.map((ep) => ({
    id: ep.id,
    kind: "episode" as const,
    label: ep.title,
    mentionCount: 0,
    factCount: ep.linkedFactIds.length,
    avgMemoryStrength: 1.0,
    createdAt: ep.createdAt.toISOString(),
  }));

  const decisionNodes: GraphNode[] = decisions.map((d) => ({
    id: d.id,
    kind: "decision" as const,
    label: d.title,
    mentionCount: 0,
    factCount: 0,
    avgMemoryStrength: 1.0,
    createdAt: d.createdAt.toISOString(),
  }));

  const allNodes = [...entityNodes, ...episodeNodes, ...decisionNodes];
  const nodeIds = new Set(allNodes.map((n) => n.id));

  const edges: GraphEdge[] = relations
    .filter((r) => nodeIds.has(r.sourceId) && nodeIds.has(r.targetId))
    .map((r) => ({
      id: r.id,
      source: r.sourceId,
      target: r.targetId,
      relation: r.relation,
      confidence: r.confidence ?? 0.7,
      provenance: r.provenance,
    }));

  if (opts.focusEntityId) {
    const focus = opts.focusEntityId;
    const neighborIds = new Set<string>([focus]);
    for (const e of edges) {
      if (e.source === focus) neighborIds.add(e.target);
      if (e.target === focus) neighborIds.add(e.source);
    }
    const focusNodes = allNodes.filter((n) => neighborIds.has(n.id));
    const focusEdges = edges.filter((e) => neighborIds.has(e.source) && neighborIds.has(e.target));
    return {
      nodes: focusNodes,
      edges: focusEdges,
      meta: {
        entityCount: focusNodes.filter((n) => n.kind === "entity").length,
        episodeCount: focusNodes.filter((n) => n.kind === "episode").length,
        decisionCount: focusNodes.filter((n) => n.kind === "decision").length,
        relationCount: focusEdges.length,
      },
    };
  }

  return {
    nodes: allNodes,
    edges,
    meta: {
      entityCount: entityNodes.length,
      episodeCount: episodeNodes.length,
      decisionCount: decisionNodes.length,
      relationCount: edges.length,
    },
  };
}

export async function buildGraphQuery(
  tx: Tx,
  workspaceId: string,
  opts: GraphQueryOptions = {}
): Promise<GraphResponse> {
  const [entities, episodes, decisions, factStats, relations] = await Promise.all([
    tx.select().from(schema.mnemoEntity).where(eq(schema.mnemoEntity.workspaceId, workspaceId)),

    tx
      .select()
      .from(schema.mnemoEpisode)
      .where(
        and(
          eq(schema.mnemoEpisode.workspaceId, workspaceId),
          eq(schema.mnemoEpisode.isSynthetic, false)
        )
      ),

    tx
      .select()
      .from(schema.mnemoDecisions)
      .where(
        and(
          eq(schema.mnemoDecisions.workspaceId, workspaceId),
          eq(schema.mnemoDecisions.status, "active")
        )
      ),

    tx
      .select({
        entityId: schema.mnemoFacts.entityId,
        factCount: sql<number>`cast(count(*) as int)`,
        avgMemoryStrength: sql<number>`coalesce(avg(${schema.mnemoFacts.memoryStrength}), 1.0)`,
      })
      .from(schema.mnemoFacts)
      .where(
        and(
          eq(schema.mnemoFacts.workspaceId, workspaceId),
          eq(schema.mnemoFacts.status, "active"),
          isNotNull(schema.mnemoFacts.entityId)
        )
      )
      .groupBy(schema.mnemoFacts.entityId),

    tx
      .select()
      .from(schema.mnemoRelations)
      .where(
        and(
          eq(schema.mnemoRelations.workspaceId, workspaceId),
          isNull(schema.mnemoRelations.validTo),
          ne(schema.mnemoRelations.judgmentStatus, "dismissed")
        )
      ),
  ]);

  return buildGraphData(entities, episodes, decisions, factStats, relations, opts);
}
