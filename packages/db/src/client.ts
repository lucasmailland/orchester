import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DbClient = ReturnType<typeof createDbClient>;

let cachedDb: DbClient | null = null;

export function createDbClient(connectionString: string) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  return drizzle(sql, { schema });
}

export function getDb(): DbClient {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  if (!cachedDb) {
    cachedDb = createDbClient(url);
  }

  return cachedDb;
}
