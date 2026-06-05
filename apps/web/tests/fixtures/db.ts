// apps/web/tests/fixtures/db.ts
//
// Spins up an isolated postgres container per test process, applies all
// drizzle migrations + hand-rolled SQL migrations, then exposes a real
// postgres-js client. Reused across integration suites so we pay
// container startup only once.
//
// Uses postgres-js (NOT node-postgres/pg) so we stay on the same drizzle
// peer-resolution as production code — pulling `pg` into apps/web triggers
// a duplicate drizzle-orm install (incompatible nominal types across the
// codebase). Sticking with postgres-js keeps the type graph deduped.
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import fs from "fs/promises";

let container: StartedTestContainer | null = null;
let sql: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase | null = null;
let containerUrl: string | null = null;

/**
 * Connection string for the active testcontainer. Exposed so isolation tests
 * can spin up additional postgres-js clients against the same container with
 * different credentials (e.g. as `app_user` via `?user=…` to exercise FORCE
 * RLS). Returns null before setupTestDb() has been called.
 */
export function getTestDbUrl(): string | null {
  return containerUrl;
}

export async function setupTestDb(): Promise<{
  db: PostgresJsDatabase;
  sql: ReturnType<typeof postgres>;
}> {
  if (db && sql) return { db, sql };

  // pgvector image — the drizzle baseline runs `CREATE EXTENSION vector`,
  // so we need a postgres image that ships with the extension.
  //
  // Wait strategy: postgres prints
  // "database system is ready to accept connections" once during
  // `initdb` (initial bootstrap) and a second time when the real
  // server has bound to the port. If we connect on the first one
  // we hit `57P03 the database system is starting up` and every
  // migration fails. Waiting for the second occurrence is the
  // documented fix.
  container = await new GenericContainer("pgvector/pgvector:pg15")
    .withEnvironment({
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "orchester",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(60_000)
    .start();

  const port = container.getMappedPort(5432);
  const host = container.getHost();
  const url = `postgres://postgres:test@${host}:${port}/orchester`;
  containerUrl = url;

  // Expose the connection string so `getDb()` (postgres-js, called by
  // production code under test) points at the same container.
  process.env["DATABASE_URL"] = url;

  sql = postgres(url, { max: 5, onnotice: () => {} });
  db = drizzle(sql);

  // Wire @mnemosyne/core's DI registry to the testcontainer client. The
  // shared helper at lib/mnemo/wire-di.ts is the single source of truth
  // used by both production entrypoints (Next.js instrumentation, worker
  // process). Tests bypass that helper and call setDb directly with
  // `force: true` because the testcontainer's drizzle client is a
  // different reference than orchGetDb() — wireMnemoDb() would resolve
  // to the empty mock client from `@orchester/db` (mocked in
  // vitest.setup.ts), not the testcontainer client we just built.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { setDb } = await import("@mnemosyne/core/db");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDb(db as any, { force: true });

  // 1. Apply the drizzle-kit baseline + indexes (these own the schema and
  //    ship a meta/_journal.json so the migrator can resume).
  //
  // Cast: pnpm resolves drizzle-orm into two peer variants (one with
  // @types/pg pulled in by pg-boss, one without via @orchester/db). At
  // runtime both copies are byte-identical (same version, same package),
  // but TS treats them as nominally distinct. The cast is safe and
  // narrowly scoped to the migrator boundary.
  await migrate(db as unknown as Parameters<typeof migrate>[0], {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/db/drizzle"),
  });

  // 2. Apply hand-rolled SQL migrations on top (lifecycle, audit chain,
  //    RLS helpers, etc.). These don't have a drizzle journal — just run
  //    every `*.sql` that isn't a `.down.sql` in lexicographic order.
  const sqlDir = path.resolve(__dirname, "../../../../packages/db/migrations");
  const files = (await fs.readdir(sqlDir))
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();
  for (const file of files) {
    const body = await fs.readFile(path.join(sqlDir, file), "utf8");
    await sql.unsafe(body);
  }

  // Roles are created by migration 0007_postgres_roles.sql above. No
  // additional setup needed here — superuser `postgres` bypasses RLS so
  // tests can read/write freely without explicit role switching.

  return { db, sql };
}

export async function teardownTestDb(): Promise<void> {
  await sql?.end({ timeout: 5 });
  await container?.stop();
  sql = null;
  db = null;
  container = null;
  containerUrl = null;
}
