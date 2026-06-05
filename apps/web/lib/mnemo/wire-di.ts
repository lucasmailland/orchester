// apps/web/lib/mnemo/wire-di.ts
//
// Single source of truth for wiring @mnemosyne/core's DI registry to
// Orchester's existing postgres pool.
//
// @mnemosyne/core v2.0 cut the cord with @orchester/db: it no longer
// owns its DB connection. Every entrypoint that touches the library
// (Next.js process, worker process, integration test fixtures) MUST
// call setDb() once at boot or any withMnemoTx / searchMnemo /
// recallUnified call throws "No DB client registered".
//
// Centralising the wiring here prevents the "I forgot the worker"
// class of bug — a missing setDb() in one entrypoint silently breaks
// every cron and brain-extract job downstream.
//
// ── Why we reuse Orchester's pool instead of opening a second one ──
// @mnemosyne/core only uses Drizzle's select/insert/update/delete
// fluent builder; it never reaches into db.query.* (the relational
// API where the schema type parameter affects runtime). The schemas
// in @orchester/db and @mnemosyne/core for the shared mnemo_* tables
// are structurally identical (column names, types, defaults verified
// in code review of feat/mnemosyne-v2-integration). A single pool
// keeps connection-count low and lifecycle simple.
//
// ── HMR / double-boot safety ──
// setDb() throws on second registration unless { force: true }. We
// probe via getDb() first so HMR hot-reloads in dev don't crash and
// so tests that call wireMnemoDb() repeatedly succeed.

/**
 * Ensure @mnemosyne/core has a DB client registered. Safe to call
 * multiple times — idempotent.
 *
 * @returns true on first registration, false if already wired
 */
export async function wireMnemoDb(): Promise<boolean> {
  const { setDb, getDb } = await import("@mnemosyne/core/db");
  try {
    getDb();
    return false; // already registered
  } catch {
    // Not yet — fall through and register
  }

  const { getDb: orchGetDb } = await import("@orchester/db");
  // Schema-bridge cast: orchGetDb() returns PostgresJsDatabase<OrchestrSchema>,
  // setDb expects PostgresJsDatabase<MnemoSchema>. @mnemosyne/core only uses
  // the fluent builder (no db.query.* relational API), so column-name SQL is
  // identical regardless of the schema type parameter. Verified by code review.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDb(orchGetDb() as any);
  return true;
}
