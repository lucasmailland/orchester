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
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import fs from "fs/promises";

let container: StartedTestContainer | null = null;
let sql: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase | null = null;

export async function setupTestDb(): Promise<{
  db: PostgresJsDatabase;
  sql: ReturnType<typeof postgres>;
}> {
  if (db && sql) return { db, sql };

  // pgvector image — the drizzle baseline runs `CREATE EXTENSION vector`,
  // so we need a postgres image that ships with the extension.
  container = await new GenericContainer("pgvector/pgvector:pg15")
    .withEnvironment({
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "orchester",
    })
    .withExposedPorts(5432)
    .start();

  const port = container.getMappedPort(5432);
  const host = container.getHost();
  const url = `postgres://postgres:test@${host}:${port}/orchester`;

  // Expose the connection string so `getDb()` (postgres-js, called by
  // production code under test) points at the same container.
  process.env["DATABASE_URL"] = url;

  sql = postgres(url, { max: 5, onnotice: () => {} });
  db = drizzle(sql);

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
}
