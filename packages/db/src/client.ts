import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DbClient = ReturnType<typeof createDbClient>;

// Survive Next.js dev HMR: stash the client on globalThis so module re-evaluation
// doesn't re-create the connection pool on every save.
const globalForDb = globalThis as unknown as {
  __orchesterDb?: DbClient;
  __orchesterPg?: ReturnType<typeof postgres>;
};

export function createDbClient(connectionString: string) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Prepared statements cache query plans → ~3-10x speedup on hot paths.
    prepare: true,
  });

  return drizzle(sql, { schema });
}

export function getDb(): DbClient {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  if (!globalForDb.__orchesterDb) {
    globalForDb.__orchesterDb = createDbClient(url);
  }

  return globalForDb.__orchesterDb;
}
