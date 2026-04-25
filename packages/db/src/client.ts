import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

let cachedDb: PostgresJsDatabase | null = null;

export function createDbClient(connectionString: string): PostgresJsDatabase {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  return drizzle(sql);
}

export function getDb(): PostgresJsDatabase {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  if (!cachedDb) {
    cachedDb = createDbClient(url);
  }

  return cachedDb;
}
