// apps/web/tests/fixtures/db.ts
//
// Spins up an isolated postgres container per test process, applies all
// drizzle migrations, and seeds the app/cron roles required by RLS in
// Phase A. Reused across integration suites so we pay container startup
// only once.
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import fs from "fs/promises";

let container: StartedTestContainer | null = null;
let pool: Pool | null = null;
let db: NodePgDatabase | null = null;

export async function setupTestDb(): Promise<{
  db: NodePgDatabase;
  pool: Pool;
  cronPool: Pool;
}> {
  if (db && pool) return { db, pool, cronPool: pool };

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

  pool = new Pool({
    host,
    port,
    user: "postgres",
    password: "test",
    database: "orchester",
  });

  // Expose the connection string so `getDb()` (postgres-js, called by
  // production code under test) points at the same container.
  process.env["DATABASE_URL"] = `postgres://postgres:test@${host}:${port}/orchester`;

  db = drizzle(pool);

  // 1. Apply the drizzle-kit baseline + indexes (these own the schema and
  //    ship a meta/_journal.json so the migrator can resume).
  await migrate(db, {
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
    const sql = await fs.readFile(path.join(sqlDir, file), "utf8");
    await pool.query(sql);
  }

  // Roles are created by migration 0007_postgres_roles.sql above. No
  // additional setup needed here — superuser `postgres` bypasses RLS so
  // tests can read/write freely without explicit role switching.

  return { db, pool, cronPool: pool };
}

export async function teardownTestDb(): Promise<void> {
  await pool?.end();
  await container?.stop();
  pool = null;
  db = null;
  container = null;
}
