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

let container: StartedTestContainer | null = null;
let pool: Pool | null = null;
let db: NodePgDatabase | null = null;

export async function setupTestDb(): Promise<{
  db: NodePgDatabase;
  pool: Pool;
  cronPool: Pool;
}> {
  if (db && pool) return { db, pool, cronPool: pool };

  container = await new GenericContainer("postgres:15-alpine")
    .withEnvironment({
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "orchester_test",
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
    database: "orchester_test",
  });

  db = drizzle(pool);

  // Apply migrations (in order)
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/db/migrations"),
  });

  // Set up roles (Task A.10)
  await pool.query(`
    CREATE ROLE app_user NOINHERIT LOGIN PASSWORD 'app';
    CREATE ROLE cron_admin NOINHERIT LOGIN PASSWORD 'cron' BYPASSRLS;
    GRANT CONNECT ON DATABASE orchester_test TO app_user, cron_admin;
    GRANT USAGE ON SCHEMA public TO app_user, cron_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
      TO app_user, cron_admin;
    REVOKE UPDATE, DELETE ON audit_log FROM app_user;
    REVOKE UPDATE, DELETE ON security_event FROM app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, cron_admin;
  `);

  return { db, pool, cronPool: pool };
}

export async function teardownTestDb(): Promise<void> {
  await pool?.end();
  await container?.stop();
  pool = null;
  db = null;
  container = null;
}
