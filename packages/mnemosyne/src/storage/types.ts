// packages/mnemosyne/src/storage/types.ts
//
// MnemoStorage — the abstract storage interface that decouples the
// Mnemosyne recall/extraction pipelines from any specific ORM or
// query layer.
//
// Why this exists
// ---------------
// The first public release of Mnemosyne uses Drizzle ORM throughout
// because that's what Orchester (the host product that birthed it)
// uses. That's a fine default but it's a hard dependency for any
// downstream product that wants to integrate Mnemosyne with a
// different stack (Prisma, raw `pg`, edge runtimes with no Drizzle
// support, Cloudflare D1, etc.).
//
// `MnemoStorage` defines the minimum surface a storage adapter has
// to implement for the core recall path. Anything that satisfies
// the interface plugs in via `createMnemoClient({ storage })`.
//
// Current status
// --------------
// v1.6 ships:
//   - This interface (a contract for adapter authors).
//   - `createDrizzleStorage(tx)` — the default Drizzle implementation
//     wrapping the existing query primitives.
//   - `createMnemoClient({ storage }).recall(query)` — a thin client
//     façade that lets adapter-using consumers reach the recall path
//     without touching the legacy `withMnemoTx` API.
//
// What v2.0 will add:
//   - Adapter coverage for the full surface: write paths
//     (`createFact`, `saveFactWithCandidates`), maintenance
//     (`prune`, `dedup`, `consolidate`), bitemporal queries,
//     review queue.
//   - Reference adapter for `pg` (no ORM) + `prisma`.
//   - Test suite that runs against an in-memory mock adapter so
//     consumers can unit-test their integration without a real DB.
//
// Design rules
// ------------
// 1. The interface returns plain types, not Drizzle row objects.
//    The adapter implementer's job is the impedance match. We use
//    structural types (`MnemoFactRecord`, etc.) defined alongside
//    so the consumer's code never imports drizzle.
//
// 2. Every method is workspace-scoped via explicit `workspaceId`
//    argument. The host (not the adapter) is responsible for
//    isolation — typically by wrapping the call in a workspace-
//    scoped transaction. This keeps the adapter contract simple
//    and lets host stacks choose their own isolation primitive
//    (Postgres RLS+FORCE, app-level filters, separate DBs).
//
// 3. The interface is intentionally narrow at v1.6. Adding methods
//    later is non-breaking; making existing methods more permissive
//    is also non-breaking. Tightening signatures requires a major
//    version bump.

/**
 * A fact row as the recall pipeline sees it. Mirrors the columns
 * the public `MnemoFact` type carries, but as a plain interface so
 * adapters don't need to import the Drizzle row type.
 *
 * Adapters are free to populate `embedding` lazily (e.g. as
 * `Float32Array` only when the column was selected) — recall callers
 * that don't need the bytes should not pay the bandwidth.
 */
export interface MnemoFactRecord {
  id: string;
  workspaceId: string;
  subject: string;
  kind: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  status: "active" | "archived" | "merged" | string;
  createdAt: Date;
  updatedAt: Date;
  /** Optional — present only when the adapter was asked for it. */
  embedding?: Float32Array | null;
  /** Free-form metadata; adapter passes through verbatim. */
  metadata?: Record<string, unknown>;
}

export interface VectorSearchInput {
  workspaceId: string;
  /** Pre-embedded query vector. The adapter does NOT embed — the
   *  caller is responsible (so the adapter contract doesn't carry
   *  embed-provider details). */
  vector: Float32Array;
  /** Default 25 — recall callers usually downsample after blending. */
  topK?: number;
  /** `asOf` for bitemporal queries. Adapter implementations that
   *  don't support bitemporal MUST throw `MnemoCapabilityError` so
   *  callers can degrade gracefully. */
  asOf?: Date;
  /** Restrict to facts whose status is in this set. Default
   *  `["active"]`. */
  statusFilter?: ReadonlyArray<string>;
}

export interface VectorSearchHit {
  fact: MnemoFactRecord;
  /** Cosine distance ∈ [0, 2]. Lower = closer. */
  distance: number;
}

export interface FtsSearchInput {
  workspaceId: string;
  /** Raw query string — the adapter is responsible for tokenising
   *  / lemmatising to whatever the underlying full-text engine
   *  expects (Postgres tsvector, OpenSearch, etc.). */
  query: string;
  topK?: number;
  asOf?: Date;
  statusFilter?: ReadonlyArray<string>;
}

export interface FtsSearchHit {
  fact: MnemoFactRecord;
  /** Engine-defined rank. Comparable WITHIN one adapter, not across. */
  rank: number;
}

/**
 * Errors the adapter throws when asked to do something it can't.
 *
 * Recall callers catch this and degrade (e.g. an adapter without
 * bitemporal support just ignores `asOf`).
 */
export class MnemoCapabilityError extends Error {
  constructor(
    public readonly capability: "vectorSearch" | "ftsSearch" | "bitemporal" | "graphExpansion",
    message: string
  ) {
    super(message);
    this.name = "MnemoCapabilityError";
  }
}

/**
 * The storage adapter contract.
 *
 * v1.6 covers the read side of recall. Adapter authors implementing
 * a new backend should focus on these methods first; the package
 * will continue adding methods (`createFact`, `archiveFact`, etc.)
 * in a non-breaking way through v2.0.
 *
 * Capability discovery: an adapter can advertise what it can NOT do
 * by setting the corresponding flag on `capabilities` to `false`.
 * Recall logic checks before calling and skips unsupported branches.
 */
export interface MnemoStorage {
  /**
   * Machine-readable identifier for telemetry / logging. Should be
   * stable across releases of the adapter (e.g. `"drizzle@1.6"`).
   */
  readonly id: string;

  /**
   * Self-described feature flags. `true` means the adapter
   * implements the corresponding method WITH the listed semantics.
   * Callers check before invoking a feature; the default Drizzle
   * adapter sets all `true`.
   */
  readonly capabilities: {
    vectorSearch: boolean;
    ftsSearch: boolean;
    bitemporal: boolean;
    graphExpansion: boolean;
  };

  /**
   * Cosine-similarity nearest-neighbour search against the
   * workspace's fact embeddings. The adapter handles the index
   * (HNSW, IVFFlat, brute-force — whatever the backend supports).
   *
   * Order: ascending by `distance` (closer first).
   */
  vectorSearch(input: VectorSearchInput): Promise<VectorSearchHit[]>;

  /**
   * Full-text search against the fact statements. Backends differ
   * (Postgres tsvector + ts_rank_cd, OpenSearch BM25, Meilisearch,
   * …) but the contract is "best-matching facts first."
   */
  ftsSearch(input: FtsSearchInput): Promise<FtsSearchHit[]>;

  /**
   * Fetch facts by primary id, in the same order as the input.
   * Used by the rerank stage which needs the full row for hits
   * surfaced by upstream stages that returned only ids.
   *
   * Missing ids are silently dropped (the rerank skips them) —
   * callers should not rely on `output.length === input.length`.
   */
  getFactsByIds(workspaceId: string, ids: ReadonlyArray<string>): Promise<MnemoFactRecord[]>;
}
