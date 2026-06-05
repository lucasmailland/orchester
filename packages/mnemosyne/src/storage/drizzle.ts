// packages/mnemosyne/src/storage/drizzle.ts
//
// Default `MnemoStorage` implementation, backed by Drizzle ORM +
// Postgres (the stack the Orchester monorepo uses internally).
//
// This is the "reference adapter". A consumer who chooses Path 1
// (import the package directly into a Drizzle stack) gets this for
// free. A consumer who chooses a different stack writes their own
// adapter against `MnemoStorage` from `./types.ts` and never touches
// this file.
//
// Implementation notes
// --------------------
// - We accept a Drizzle `Tx` at construction time, NOT a globally
//   imported DB handle. That keeps the adapter compatible with
//   `withMnemoTx` (which is how Orchester achieves RLS+FORCE Pattern
//   A) without leaking the workspace_id GUC contract into the
//   adapter interface itself. Consumers that prefer their own
//   isolation primitive can wire it the same way.
//
// - The queries here are deliberately a slim subset of what
//   `recall/search.ts` does. v1.6 wires only the surface
//   `createMnemoClient().recall(query)` needs. v2.0 will extend
//   coverage; the `MnemoStorage` interface is the contract that
//   keeps this work non-breaking.

import { sql, type SQL } from "drizzle-orm";
import type {
  MnemoStorage,
  VectorSearchInput,
  VectorSearchHit,
  FtsSearchInput,
  FtsSearchHit,
  MnemoFactRecord,
} from "./types";

/**
 * Loose structural type for the bits of a Drizzle pg transaction we
 * actually use. Avoids importing the Drizzle generic chain (it's
 * intrusive and changes across major versions) — anything Drizzle
 * gives a caller of `withMnemoTx` will structurally satisfy this.
 */
export interface DrizzleTxLike {
  execute<T>(query: SQL<unknown> | string): Promise<{ rows: T[] } | T[]>;
}

/**
 * Row shape returned by the SQL below. Keeps the projection explicit
 * and lets us run shape assertions in tests without depending on the
 * Drizzle schema export.
 */
interface FactRow {
  id: string;
  workspace_id: string;
  subject: string;
  kind: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
  /** Cosine distance — only present in vectorSearch results. */
  distance?: number;
  /** ts_rank_cd — only present in ftsSearch results. */
  rank?: number;
}

/**
 * Normalise the two shapes Drizzle's `.execute` returns across drivers
 * (postgres-js returns `T[]`, node-pg-pool returns `{ rows: T[] }`).
 * Adapter authors shouldn't have to know this.
 */
function extractRows<T>(raw: { rows: T[] } | T[]): T[] {
  return Array.isArray(raw) ? raw : raw.rows;
}

function toRecord(row: FactRow): MnemoFactRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    subject: row.subject,
    kind: row.kind,
    statement: row.statement,
    confidence: row.confidence,
    pinned: row.pinned,
    status: row.status as MnemoFactRecord["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Construct a Drizzle-backed `MnemoStorage`. The adapter holds a
 * reference to the tx; create a new adapter inside each per-workspace
 * scope (typically inside `withMnemoTx`).
 *
 * Example wiring inside Orchester's host:
 *
 *   await withMnemoTx(workspaceId, async (tx) => {
 *     const storage = createDrizzleStorage(tx);
 *     const client = createMnemoClient({ storage });
 *     const hits = await client.recall({ workspaceId, query, vector });
 *     // … use hits
 *   });
 */
export function createDrizzleStorage(tx: DrizzleTxLike): MnemoStorage {
  return {
    id: "drizzle@1.6",
    capabilities: {
      vectorSearch: true,
      ftsSearch: true,
      bitemporal: true,
      graphExpansion: false, // implemented at the host call site, not the adapter
    },

    async vectorSearch(input: VectorSearchInput): Promise<VectorSearchHit[]> {
      const limit = input.topK ?? 25;
      const statusList = input.statusFilter ?? ["active"];

      // We project explicit columns rather than `SELECT *` so the
      // result shape can't drift if the DB grows new columns. The
      // `<=>` operator is pgvector's cosine distance.
      const result = await tx.execute<FactRow>(sql`
        SELECT
          id,
          workspace_id,
          subject,
          kind,
          statement,
          confidence,
          pinned,
          status,
          created_at,
          updated_at,
          (embedding <=> ${Array.from(input.vector)}::halfvec(1536)) AS distance
        FROM mnemo_fact
        WHERE workspace_id = ${input.workspaceId}
          AND status = ANY(${statusList as readonly string[]})
          AND embedding IS NOT NULL
          ${input.asOf ? sql`AND created_at <= ${input.asOf}` : sql``}
        ORDER BY embedding <=> ${Array.from(input.vector)}::halfvec(1536) ASC
        LIMIT ${limit}
      `);

      return extractRows(result).map((row) => ({
        fact: toRecord(row),
        distance: row.distance ?? 0,
      }));
    },

    async ftsSearch(input: FtsSearchInput): Promise<FtsSearchHit[]> {
      const limit = input.topK ?? 25;
      const statusList = input.statusFilter ?? ["active"];

      // `plainto_tsquery` accepts a free-form string; the column
      // `text_lemmatized` is populated by the migration trigger.
      const result = await tx.execute<FactRow>(sql`
        SELECT
          id,
          workspace_id,
          subject,
          kind,
          statement,
          confidence,
          pinned,
          status,
          created_at,
          updated_at,
          ts_rank_cd(text_lemmatized, plainto_tsquery('simple', ${input.query})) AS rank
        FROM mnemo_fact
        WHERE workspace_id = ${input.workspaceId}
          AND status = ANY(${statusList as readonly string[]})
          AND text_lemmatized @@ plainto_tsquery('simple', ${input.query})
          ${input.asOf ? sql`AND created_at <= ${input.asOf}` : sql``}
        ORDER BY rank DESC
        LIMIT ${limit}
      `);

      return extractRows(result).map((row) => ({
        fact: toRecord(row),
        rank: row.rank ?? 0,
      }));
    },

    async getFactsByIds(workspaceId, ids) {
      if (ids.length === 0) return [];
      const result = await tx.execute<FactRow>(sql`
        SELECT
          id, workspace_id, subject, kind, statement,
          confidence, pinned, status, created_at, updated_at
        FROM mnemo_fact
        WHERE workspace_id = ${workspaceId}
          AND id = ANY(${ids as readonly string[]})
      `);
      // Re-order to match the caller's input ordering — useful when
      // the caller is reassembling rerank scores keyed on id.
      const byId = new Map(extractRows(result).map((r) => [r.id, toRecord(r)]));
      return ids.map((id) => byId.get(id)).filter((x): x is MnemoFactRecord => x !== undefined);
    },
  };
}
