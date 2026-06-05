// packages/mnemosyne/src/storage/client.ts
//
// `MnemoClient` — the high-level façade external consumers reach for.
//
// Why a client wrapper
// --------------------
// `MnemoStorage` is the LOW-level adapter interface (one method per
// query). Useful for backend authors, awkward for consumers who just
// want "give me the top-K facts for this question." The client wraps
// the storage with a high-level API that:
//
//   1. Composes multiple storage calls (vector + FTS) into a single
//      blended recall.
//   2. Handles capability fallback (an adapter without bitemporal
//      support quietly ignores `asOf` instead of throwing).
//   3. Surfaces a single, stable, future-proof entry point so v2.0
//      can extend coverage (write paths, maintenance) WITHOUT
//      changing the call sites.
//
// What v1.6 ships
// ---------------
// - `recall({ query, vector, topK, asOf? })` — hybrid recall over a
//   single workspace. Returns blended-and-deduplicated facts ordered
//   by a normalised score.
//
// Coming in v2.0
// --------------
// - `remember(input)` — write a fact through the adapter
// - `pin(factId)` / `forget(factId)` — curation
// - `timeline({ since })` — read recent events
// - `health()` — workspace cognitive vitals

import type { MnemoStorage, MnemoFactRecord, VectorSearchInput, FtsSearchInput } from "./types";

export interface MnemoClientOptions {
  /** The storage adapter the client will dispatch to. */
  storage: MnemoStorage;
}

export interface RecallInput {
  workspaceId: string;
  /** Free-form query text. The client passes this verbatim to FTS. */
  query: string;
  /** Pre-embedded query vector. The CALLER embeds — we don't carry
   *  embed-provider details into the client API. */
  vector: Float32Array;
  /** Final number of hits to return after blending. Default 5. */
  topK?: number;
  /** Bitemporal "as of" instant. Silently ignored when the adapter
   *  reports no bitemporal capability. */
  asOf?: Date;
  /** Weight on vector vs FTS in [0, 1]. Default 0.6 — vector
   *  dominates for conversational semantics. */
  vectorWeight?: number;
}

export interface RecallHit {
  fact: MnemoFactRecord;
  /** Blended score in [0, 1]. Higher = better. */
  score: number;
  /** Which paths contributed to surfacing this hit. */
  reasons: ReadonlyArray<"vector" | "fts">;
}

export interface MnemoClient {
  /**
   * Hybrid BM25 + vector recall. The adapter's `vectorSearch` and
   * `ftsSearch` are called in parallel; the result lists are merged
   * with `vectorWeight` as the blend factor.
   *
   * Returns `topK` facts ordered by descending blended score. Adapters
   * without one of the two backends silently drop that path
   * (capability flag) and we re-normalise weights — picking
   * vectorWeight=0.6 with no FTS still works.
   */
  recall(input: RecallInput): Promise<RecallHit[]>;
}

/**
 * Construct a `MnemoClient` wrapping the given storage. Holds no
 * state; safe to call once per request or once per worker process.
 */
export function createMnemoClient(opts: MnemoClientOptions): MnemoClient {
  const { storage } = opts;

  return {
    async recall(input: RecallInput): Promise<RecallHit[]> {
      const topK = input.topK ?? 5;
      // Pull a wider candidate set per path than we'll return; the
      // blend stage downsamples to topK.
      const innerLimit = Math.max(25, topK * 3);

      const wVec = clamp01(input.vectorWeight ?? 0.6);
      const wFts = 1 - wVec;

      const wantVector = storage.capabilities.vectorSearch && wVec > 0;
      const wantFts = storage.capabilities.ftsSearch && wFts > 0;

      // Honor bitemporal capability silently — adapters that can't
      // do it just see the absence of `asOf` in their input. This
      // keeps Path 2 (external adapters) cheap to implement.
      const baseAsOf = input.asOf && storage.capabilities.bitemporal ? { asOf: input.asOf } : {};

      const vectorPromise = wantVector
        ? storage.vectorSearch({
            workspaceId: input.workspaceId,
            vector: input.vector,
            topK: innerLimit,
            ...baseAsOf,
          } satisfies VectorSearchInput)
        : Promise.resolve([]);
      const ftsPromise = wantFts
        ? storage.ftsSearch({
            workspaceId: input.workspaceId,
            query: input.query,
            topK: innerLimit,
            ...baseAsOf,
          } satisfies FtsSearchInput)
        : Promise.resolve([]);

      const [vectorHits, ftsHits] = await Promise.all([vectorPromise, ftsPromise]);

      // Normalise distances → similarity scores in [0, 1].
      // Cosine distance is in [0, 2]; flip to similarity in [0, 1].
      const vScored = vectorHits.map((h) => ({
        id: h.fact.id,
        fact: h.fact,
        sim: clamp01(1 - h.distance / 2),
        path: "vector" as const,
      }));

      // FTS rank has no fixed upper bound; normalise per-batch by
      // dividing by the max rank in this batch. Empty batches stay
      // at 0.
      const maxFtsRank = ftsHits.reduce((m, h) => Math.max(m, h.rank), 0);
      const fScored = ftsHits.map((h) => ({
        id: h.fact.id,
        fact: h.fact,
        sim: maxFtsRank > 0 ? clamp01(h.rank / maxFtsRank) : 0,
        path: "fts" as const,
      }));

      // Re-normalise weights if one side is missing — picking
      // vectorWeight=0.6 with no FTS yields 1.0 on vector instead of
      // silently downweighting the surviving signal.
      const wVecEff = wantFts ? wVec : wantVector ? 1 : 0;
      const wFtsEff = wantVector ? wFts : wantFts ? 1 : 0;

      // Merge by id; sum the weighted contributions. A fact that
      // appears in BOTH paths gets a higher blended score than the
      // same fact appearing in only one — exactly what we want.
      const merged = new Map<
        string,
        { fact: MnemoFactRecord; score: number; reasons: Set<"vector" | "fts"> }
      >();
      for (const v of vScored) {
        merged.set(v.id, {
          fact: v.fact,
          score: v.sim * wVecEff,
          reasons: new Set<"vector" | "fts">(["vector"]),
        });
      }
      for (const f of fScored) {
        const existing = merged.get(f.id);
        if (existing) {
          existing.score += f.sim * wFtsEff;
          existing.reasons.add("fts");
        } else {
          merged.set(f.id, {
            fact: f.fact,
            score: f.sim * wFtsEff,
            reasons: new Set<"vector" | "fts">(["fts"]),
          });
        }
      }

      return Array.from(merged.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map<RecallHit>((m) => ({
          fact: m.fact,
          score: Number(m.score.toFixed(4)),
          reasons: Array.from(m.reasons),
        }));
    },
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
